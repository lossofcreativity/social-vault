const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

// ============ GLOBAL VARIABLES ============
const onlineUsers = new Map();
const userSockets = new Map();
let activeCalls = new Map();

// ============ FILE UPLOAD CONFIGURATION ============
const createMulterConfig = (folder, fileSize) => {
    const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            const fullPath = path.join(__dirname, `uploads/${folder}/`);
            if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
            cb(null, fullPath);
        },
        filename: (req, file, cb) => {
            const uniqueName = Date.now() + '-' + uuidv4() + path.extname(file.originalname);
            cb(null, uniqueName);
        }
    });

    return multer({
        storage: storage,
        limits: { fileSize: fileSize },
        fileFilter: (req, file, cb) => {
            const allowedTypes = /jpeg|jpg|png|gif|webp|mp4|mov|avi|mkv/;
            const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
            const mimetype = allowedTypes.test(file.mimetype);
            if (mimetype && extname) {
                cb(null, true);
            } else {
                cb(new Error('Invalid file type'));
            }
        }
    });
};

const uploadPost = createMulterConfig('posts', 500 * 1024 * 1024);
const uploadAvatar = createMulterConfig('avatars', 5 * 1024 * 1024);
const uploadReel = createMulterConfig('reels', 500 * 1024 * 1024);
const uploadMessageMedia = createMulterConfig('messages', 50 * 1024 * 1024); // 50MB for messages

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));



// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'social_vault_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: 1000 * 60 * 60 * 24 * 7
    }
}));

// ============ DATA HELPERS ============
const readData = (file) => {
    try {
        return fs.readJsonSync(`./data/${file}.json`);
    } catch {
        return file === 'users' ? {} : [];
    }
};

const writeData = (file, data) => {
    fs.writeJsonSync(`./data/${file}.json`, data, { spaces: 2 });
};

// ============ MESSAGING STORAGE ============
const MESSAGES_FILE = './data/messages.json';
const GROUP_CHATS_FILE = './data/groups.json';

function readMessages() {
    try {
        return fs.readJsonSync(MESSAGES_FILE);
    } catch {
        return [];
    }
}

function writeMessages(messagesData) {
    fs.writeJsonSync(MESSAGES_FILE, messagesData, { spaces: 2 });
}

function readGroups() {
    try {
        return fs.readJsonSync(GROUP_CHATS_FILE);
    } catch {
        return [];
    }
}

function writeGroups(groupsData) {
    fs.writeJsonSync(GROUP_CHATS_FILE, groupsData, { spaces: 2 });
}

// Initialize files
if (!fs.existsSync(MESSAGES_FILE)) writeMessages([]);
if (!fs.existsSync(GROUP_CHATS_FILE)) writeGroups([]);

// ============ MIDDLEWARE ============
const requireAuth = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Please login first' });
    }
    const users = readData('users');
    const user = users[req.session.userId];
    if (!user || user.isBanned) {
        req.session.destroy();
        return res.status(401).json({ error: 'Account banned or not found' });
    }
    next();
};

const requireAdmin = (req, res, next) => {
    const users = readData('users');
    const user = users[req.session.userId];
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

const canAccessMessages = (req, res, next) => {
    const currentUserId = req.session.userId;
    const otherUserId = req.params.userId;

    // For conversations list, always allow (it only shows user's own conversations)
    if (req.path === '/api/messages/conversations') {
        return next();
    }

    // User can only access messages with another user
    if (otherUserId) {
        const users = readData('users');
        const currentUser = users[currentUserId];
        const otherUser = users[otherUserId];

        if (!otherUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if they are friends OR have exchanged messages before
        const messagesData = readMessages();
        const hasConversation = messagesData.some(msg =>
            (msg.from === currentUserId && msg.to === otherUserId) ||
            (msg.from === otherUserId && msg.to === currentUserId)
        );

        if (!currentUser.friends?.includes(otherUserId) && !hasConversation) {
            return res.status(403).json({ error: 'Access denied. You are not friends with this user.' });
        }
    }

    next();
};

// ============ INITIALIZE ADMIN ============
const initAdmin = async () => {
    const users = readData('users');
    const adminEmail = process.env.ADMIN_EMAIL || 'shresthaavaya112@gmail.com';

    if (!Object.values(users).some(u => u.email === adminEmail)) {
        const adminId = 'admin_' + Date.now();
        const hashedPassword = await bcrypt.hash('qwertyuiop@112', 10);

        users[adminId] = {
            id: adminId,
            email: adminEmail,
            username: 'avayashrestha01',
            password: hashedPassword,
            bio: '✨ Admin of Social Vault ✨',
            avatar: null,
            coverPhoto: null,
            role: 'admin',
            isAdmin: true,
            isBanned: false,
            isSuspended: false,
            friends: [],
            friendRequests: [],
            createdAt: new Date().toLocaleString(),
            followers: [],
            following: []
        };
        writeData('users', users);
        console.log('✅ Admin user created');
    }
};

// ============ AUTHENTICATION ROUTES ============
app.post('/api/register', async (req, res) => {
    const { email, username, password } = req.body;

    if (!email || !username || !password) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const users = readData('users');
    const banned = readData('banned_users');

    if (banned.some(b => b.email === email)) {
        return res.status(400).json({ error: 'This email is banned' });
    }

    if (Object.values(users).some(u => u.email === email)) {
        return res.status(400).json({ error: 'Email already registered' });
    }

    if (Object.values(users).some(u => u.username === username)) {
        return res.status(400).json({ error: 'Username already taken' });
    }

    const userId = Date.now().toString();
    const hashedPassword = await bcrypt.hash(password, 10);

    users[userId] = {
        id: userId,
        email,
        username,
        password: hashedPassword,
        bio: '✨ New to Social Vault! ✨',
        avatar: null,
        coverPhoto: null,
        role: 'user',
        isAdmin: false,
        isBanned: false,
        isSuspended: false,
        friends: [],
        friendRequests: [],
        createdAt: new Date().toLocaleString(),
        followers: [],
        following: []
    };

    writeData('users', users);

    req.session.userId = userId;
    req.session.username = username;

    res.json({ success: true, user: { id: userId, username, email, bio: users[userId].bio, avatar: users[userId].avatar } });
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    const users = readData('users');
    const banned = readData('banned_users');

    if (banned.some(b => b.email === email)) {
        return res.status(401).json({ error: 'This account has been banned' });
    }

    const user = Object.values(users).find(u => u.email === email);

    if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.isBanned) {
        return res.status(401).json({ error: 'This account has been banned' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;

    res.json({ success: true, user: { id: user.id, username: user.username, email: user.email, bio: user.bio, avatar: user.avatar, role: user.role } });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/me', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    const users = readData('users');
    const user = users[req.session.userId];

    if (!user || user.isBanned) {
        req.session.destroy();
        return res.status(401).json({ error: 'User not found or banned' });
    }

    res.json({
        user: {
            id: user.id,
            username: user.username,
            email: user.email,
            bio: user.bio,
            avatar: user.avatar,
            coverPhoto: user.coverPhoto,
            role: user.role,
            friends: user.friends || [],
            friendRequests: user.friendRequests || []
        }
    });
});

// ============ PROFILE ROUTES ============
app.get('/api/@:username', (req, res) => {
    const users = readData('users');
    const user = Object.values(users).find(u => u.username === req.params.username);
    
    if (!user || user.isBanned) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    const posts = readData('posts');
    const reels = readData('reels');
    const userPosts = posts.filter(p => p.authorId === user.id);
    const userReels = reels.filter(r => r.authorId === user.id);
    
    // Format reels for profile display
    const formattedReels = userReels.map(reel => ({
        id: reel.id,
        video: reel.video || reel.video_url,
        likes: reel.likes || 0,
        views: reel.views || 0,
        title: reel.title || 'Untitled Reel',
        createdAt: reel.createdAt
    }));
    
    res.json({
        user: {
            id: user.id,
            username: user.username,
            bio: user.bio,
            avatar: user.avatar,
            coverPhoto: user.coverPhoto,
            createdAt: user.createdAt,
            friends: user.friends || [],
            role: user.role
        },
        posts: userPosts.reverse(),
        reels: formattedReels.reverse()
    });
});

app.get('/api/users/id/:userId', (req, res) => {
    const users = readData('users');
    const user = users[req.params.userId];

    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    res.json({
        user: {
            id: user.id,
            username: user.username,
            email: user.email,
            bio: user.bio,
            avatar: user.avatar,
            role: user.role,
            isOnline: onlineUsers.has(user.id)
        }
    });
});

app.put('/api/profile', requireAuth, async (req, res) => {
    const { username, bio } = req.body;
    const users = readData('users');
    const user = users[req.session.userId];

    if (username && username !== user.username) {
        if (Object.values(users).some(u => u.username === username && u.id !== user.id)) {
            return res.status(400).json({ error: 'Username already taken' });
        }
        user.username = username;
        req.session.username = username;
    }

    if (bio !== undefined) user.bio = bio;

    writeData('users', users);

    res.json({ success: true, user: { id: user.id, username: user.username, bio: user.bio, avatar: user.avatar } });
});

// ============ UPDATE AVATAR EVERYWHERE ============
app.post('/api/upload-avatar', requireAuth, uploadAvatar.single('avatar'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const users = readData('users');
    const user = users[req.session.userId];

    // Delete old avatar if exists
    if (user.avatar) {
        const oldPath = path.join(__dirname, user.avatar);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const newAvatarUrl = `/uploads/avatars/${req.file.filename}`;
    user.avatar = newAvatarUrl;
    writeData('users', users);

    // Update avatar in ALL posts
    const posts = readData('posts');
    let postsUpdated = false;
    
    posts.forEach(post => {
        if (post.authorId === user.id) {
            post.authorAvatar = newAvatarUrl;
            postsUpdated = true;
        }
        // Update comments in posts
        if (post.comments && post.comments.length > 0) {
            post.comments.forEach(comment => {
                if (comment.userId === user.id) {
                    comment.avatar = newAvatarUrl;
                    postsUpdated = true;
                }
            });
        }
    });
    
    if (postsUpdated) writeData('posts', posts);

    // Update avatar in ALL reels
    const reels = readData('reels');
    let reelsUpdated = false;
    
    reels.forEach(reel => {
        if (reel.authorId === user.id) {
            reel.authorAvatar = newAvatarUrl;
            reelsUpdated = true;
        }
        // Update comments in reels
        if (reel.comments && reel.comments.length > 0) {
            reel.comments.forEach(comment => {
                if (comment.userId === user.id) {
                    comment.avatar = newAvatarUrl;
                    reelsUpdated = true;
                }
            });
        }
    });
    
    if (reelsUpdated) writeData('reels', reels);

    // Update avatar in messages
    const messages = readMessages();
    let messagesUpdated = false;
    
    messages.forEach(msg => {
        if (msg.from === user.id) {
            msg.fromAvatar = newAvatarUrl;
            messagesUpdated = true;
        }
    });
    
    if (messagesUpdated) writeMessages(messages);

    // Emit socket event to update avatar in real-time for all connected clients
    io.emit('avatar_updated', {
        userId: user.id,
        avatar: newAvatarUrl
    });

    res.json({ success: true, avatar: user.avatar });
});


// ============ UPLOAD COVER PHOTO ============
app.post('/api/upload-cover', requireAuth, uploadAvatar.single('cover'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const users = readData('users');
    const user = users[req.session.userId];

    // Delete old cover if exists
    if (user.coverPhoto) {
        const oldPath = path.join(__dirname, user.coverPhoto);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    user.coverPhoto = `/uploads/avatars/${req.file.filename}`;
    writeData('users', users);

    res.json({ success: true, coverPhoto: user.coverPhoto });
});

// ============ POST ROUTES ============
// Fix the posts route to handle both old and new post formats
// Fix the posts route to handle both old and new post formats
app.get('/api/posts', (req, res) => {
    let posts = readData('posts');
    const filter = req.query.filter;
    const currentUserId = req.session.userId;

    if (filter === 'friends' && currentUserId) {
        const users = readData('users');
        const user = users[currentUserId];
        posts = posts.filter(p => (user.friends || []).includes(p.authorId) || p.authorId === currentUserId);
    } else if (filter === 'images') {
        posts = posts.filter(p => p.media && (p.mediaType === 'image' || (p.media && p.media[0]?.type === 'image')));
    } else if (filter === 'videos') {
        posts = posts.filter(p => p.media && (p.mediaType === 'video' || (p.media && p.media[0]?.type === 'video')));
    }

    // Normalize posts to have consistent media structure
    posts = posts.map(post => {
        // Handle old format (single media)
        if (post.media && !Array.isArray(post.media) && typeof post.media === 'string') {
            return {
                ...post,
                media: [{ url: post.media, type: post.mediaType || 'image' }],
                isMultiple: false
            };
        }
        // Handle new format (multiple media)
        if (post.media && Array.isArray(post.media)) {
            return {
                ...post,
                media: post.media,
                isMultiple: post.media.length > 1
            };
        }
        // No media
        return {
            ...post,
            media: [],
            isMultiple: false
        };
    });

    posts = posts.map(post => ({
        ...post,
        isLiked: currentUserId ? (post.likedBy || []).includes(currentUserId) : false,
        isAuthor: currentUserId === post.authorId
    }));

    res.json(posts.reverse());
});

// ============ FIXED POST CREATION ROUTE ============
// Replace the existing uploadPost with this (or add new config)
const uploadPostMultiple = createMulterConfig('posts', 500 * 1024 * 1024);

app.post('/api/posts', requireAuth, uploadPost.array('media', 10), (req, res) => {
    const { title, description, visibility } = req.body;

    if (!title || title.trim() === '') {
        return res.status(400).json({ error: 'Title is required' });
    }

    const users = readData('users');
    const user = users[req.session.userId];
    const posts = readData('posts');

    // Handle multiple files
    const mediaFiles = req.files ? req.files.map(file => ({
        url: `/uploads/posts/${file.filename}`,
        type: file.mimetype.startsWith('video/') ? 'video' : 'image',
        filename: file.filename
    })) : [];

    const newPost = {
        id: Date.now().toString(),
        title: title.trim(),
        description: description ? description.trim() : '',
        media: mediaFiles,
        mediaType: mediaFiles.length > 0 ? (mediaFiles[0].type === 'video' ? 'video' : 'image') : null,
        isMultiple: mediaFiles.length > 1,
        author: user.username,
        authorId: user.id,
        authorAvatar: user.avatar,
        visibility: visibility || 'public',
        createdAt: new Date().toLocaleString(),
        likes: 0,
        likedBy: [],
        comments: [],
        shares: 0
    };

    posts.unshift(newPost);
    writeData('posts', posts);

    // Update trending hashtags
    updateTrendingHashtags(newPost);

    res.json({
        success: true,
        post: newPost,
        message: 'Post created successfully!'
    });
});

app.put('/api/posts/:id', requireAuth, (req, res) => {
    const { title, description } = req.body;
    const posts = readData('posts');
    const postIndex = posts.findIndex(p => p.id === req.params.id);

    if (postIndex === -1) {
        return res.status(404).json({ error: 'Post not found' });
    }

    const post = posts[postIndex];

    // Check if user is author or admin
    const users = readData('users');
    const currentUser = users[req.session.userId];
    if (post.authorId !== req.session.userId && currentUser.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    // Update post
    if (title) post.title = title;
    if (description !== undefined) post.description = description;

    writeData('posts', posts);

    // Update trending hashtags (optional - could recalculate)
    // updateTrendingHashtags(post);

    res.json({ success: true, post: post });
});

app.get('/api/posts/:id', (req, res) => {
    const posts = readData('posts');
    const post = posts.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const currentUserId = req.session.userId;
    res.json({
        ...post,
        isLiked: currentUserId ? (post.likedBy || []).includes(currentUserId) : false,
        isAuthor: currentUserId === post.authorId
    });
});

app.post('/api/posts/:id/like', requireAuth, (req, res) => {
    const posts = readData('posts');
    const postIndex = posts.findIndex(p => p.id === req.params.id);
    if (postIndex === -1) return res.status(404).json({ error: 'Post not found' });

    const post = posts[postIndex];
    const userId = req.session.userId;
    if (!post.likedBy) post.likedBy = [];

    if (post.likedBy.includes(userId)) {
        post.likedBy = post.likedBy.filter(id => id !== userId);
        post.likes--;
    } else {
        post.likedBy.push(userId);
        post.likes++;
    }

    writeData('posts', posts);
    res.json({ success: true, likes: post.likes, isLiked: post.likedBy.includes(userId) });
});

app.post('/api/posts/:id/comment', requireAuth, (req, res) => {
    const { comment } = req.body;
    if (!comment || comment.trim() === '') {
        return res.status(400).json({ error: 'Comment cannot be empty' });
    }

    const posts = readData('posts');
    const postIndex = posts.findIndex(p => p.id === req.params.id);
    if (postIndex === -1) return res.status(404).json({ error: 'Post not found' });

    const users = readData('users');
    const user = users[req.session.userId];

    const newComment = {
        id: Date.now().toString(),
        userId: user.id,
        username: user.username,
        avatar: user.avatar,
        comment: comment.trim(),
        createdAt: new Date().toLocaleString()
    };

    if (!posts[postIndex].comments) posts[postIndex].comments = [];
    posts[postIndex].comments.push(newComment);
    writeData('posts', posts);

    res.json({ success: true, comment: newComment });
});

app.post('/api/posts/:id/share', requireAuth, (req, res) => {
    const posts = readData('posts');
    const postIndex = posts.findIndex(p => p.id === req.params.id);
    if (postIndex === -1) return res.status(404).json({ error: 'Post not found' });

    posts[postIndex].shares++;
    writeData('posts', posts);
    res.json({ success: true, shares: posts[postIndex].shares });
});

// Fix delete post - handle both single and multiple media
app.delete('/api/posts/:id', requireAuth, (req, res) => {
    const posts = readData('posts');
    const postIndex = posts.findIndex(p => p.id === req.params.id);

    if (postIndex === -1) {
        return res.status(404).json({ error: 'Post not found' });
    }

    const post = posts[postIndex];
    const users = readData('users');
    const currentUser = users[req.session.userId];

    // Check if user is author or admin
    if (post.authorId !== req.session.userId && currentUser.role !== 'admin') {
        return res.status(403).json({ error: 'You can only delete your own posts' });
    }

    // Delete media files - handle both single and multiple
    if (post.media) {
        if (Array.isArray(post.media)) {
            // Multiple files - delete each one
            post.media.forEach(mediaItem => {
                const mediaUrl = typeof mediaItem === 'string' ? mediaItem : mediaItem.url;
                if (mediaUrl) {
                    const mediaPath = path.join(__dirname, mediaUrl);
                    if (fs.existsSync(mediaPath)) {
                        fs.unlinkSync(mediaPath);
                        console.log(`Deleted: ${mediaPath}`);
                    }
                }
            });
        } else if (typeof post.media === 'string') {
            // Single file
            const mediaPath = path.join(__dirname, post.media);
            if (fs.existsSync(mediaPath)) {
                fs.unlinkSync(mediaPath);
                console.log(`Deleted: ${mediaPath}`);
            }
        }
    }

    // Remove post from array
    posts.splice(postIndex, 1);
    writeData('posts', posts);

    res.json({ success: true, message: 'Post deleted successfully' });
});

// ============ HASHTAG FUNCTIONS FOR SERVER ============

// Extract hashtags from text
function extractHashtags(text) {
    if (!text) return [];
    const hashtagRegex = /#(\w+)/g;
    const matches = text.match(hashtagRegex);
    if (!matches) return [];
    return matches.map(tag => tag.toLowerCase());
}

// Update trending hashtags when post is created/modified
function updateTrendingHashtags(post) {
    const content = (post.title || '') + ' ' + (post.description || '');
    const hashtags = extractHashtags(content);
    if (hashtags.length === 0) return;

    let trending = readData('trending');
    if (!Array.isArray(trending)) trending = [];

    hashtags.forEach(tag => {
        const existing = trending.find(t => t.tag === tag);
        if (existing) {
            existing.count++;
            existing.lastUsed = new Date().toISOString();
        } else {
            trending.push({
                tag: tag,
                count: 1,
                firstSeen: new Date().toISOString(),
                lastUsed: new Date().toISOString()
            });
        }
    });

    // Sort by count and limit to 20
    trending.sort((a, b) => b.count - a.count);
    writeData('trending', trending.slice(0, 20));
}

// Get trending hashtags
app.get('/api/trending', (req, res) => {
    let trending = readData('trending');
    if (!Array.isArray(trending)) trending = [];

    // Get top 10 trending hashtags
    const topTrending = trending.slice(0, 10).map(t => ({
        tag: t.tag,
        count: t.count,
        posts: t.count
    }));

    res.json(topTrending);
});

// Search by hashtag
app.get('/api/hashtag/:tag', (req, res) => {
    const tag = '#' + req.params.tag;
    const posts = readData('posts');

    const hashtagPosts = posts.filter(post => {
        const content = (post.title + ' ' + (post.description || '')).toLowerCase();
        return content.includes(tag.toLowerCase());
    });

    const currentUserId = req.session.userId;
    const formattedPosts = hashtagPosts.map(post => ({
        ...post,
        isLiked: currentUserId ? (post.likedBy || []).includes(currentUserId) : false,
        isAuthor: currentUserId === post.authorId
    }));

    res.json(formattedPosts);
});

// ============ MESSAGE MEDIA UPLOAD ============
app.post('/api/messages/media', requireAuth, uploadMessageMedia.single('media'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileUrl = `/uploads/messages/${req.file.filename}`;
    const fileType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';

    res.json({
        success: true,
        fileUrl: fileUrl,
        fileType: fileType,
        filename: req.file.filename
    });
});

// ============ FRIEND ROUTES ============
app.post('/api/friends/request/:userId', requireAuth, (req, res) => {
    const users = readData('users');
    const currentUser = users[req.session.userId];
    const targetUser = users[req.params.userId];

    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    if (currentUser.id === targetUser.id) return res.status(400).json({ error: 'Cannot add yourself' });
    if ((currentUser.friends || []).includes(targetUser.id)) return res.status(400).json({ error: 'Already friends' });

    if (!targetUser.friendRequests) targetUser.friendRequests = [];
    if (!targetUser.friendRequests.includes(currentUser.id)) {
        targetUser.friendRequests.push(currentUser.id);
        writeData('users', users);
        io.to(`user_${targetUser.id}`).emit('friend_request', {
            fromUserId: currentUser.id,
            fromUsername: currentUser.username,
            fromAvatar: currentUser.avatar
        });
    }
    res.json({ success: true });
});

app.post('/api/friends/accept/:userId', requireAuth, (req, res) => {
    const users = readData('users');
    const currentUser = users[req.session.userId];
    const requesterUser = users[req.params.userId];
    if (!requesterUser) return res.status(404).json({ error: 'User not found' });

    if (!currentUser.friendRequests) currentUser.friendRequests = [];
    currentUser.friendRequests = currentUser.friendRequests.filter(id => id !== requesterUser.id);
    if (!currentUser.friends) currentUser.friends = [];
    if (!requesterUser.friends) requesterUser.friends = [];
    currentUser.friends.push(requesterUser.id);
    requesterUser.friends.push(currentUser.id);
    writeData('users', users);
    io.to(`user_${requesterUser.id}`).emit('friend_accepted', { userId: currentUser.id, username: currentUser.username });
    res.json({ success: true });
});

app.post('/api/friends/decline/:userId', requireAuth, (req, res) => {
    const users = readData('users');
    const currentUser = users[req.session.userId];
    if (currentUser.friendRequests) {
        currentUser.friendRequests = currentUser.friendRequests.filter(id => id !== req.params.userId);
        writeData('users', users);
    }
    res.json({ success: true });
});

app.get('/api/friends', requireAuth, (req, res) => {
    const users = readData('users');
    const currentUser = users[req.session.userId];
    const friends = (currentUser.friends || []).map(friendId => {
        const friend = users[friendId];
        return friend ? {
            id: friend.id,
            username: friend.username,
            avatar: friend.avatar,
            bio: friend.bio,
            isOnline: onlineUsers.has(friend.id)
        } : null;
    }).filter(f => f);
    res.json(friends);
});

app.get('/api/friend-requests', requireAuth, (req, res) => {
    const users = readData('users');
    const currentUser = users[req.session.userId];
    const requests = (currentUser.friendRequests || []).map(requesterId => {
        const requester = users[requesterId];
        return requester ? {
            id: requester.id,
            username: requester.username,
            avatar: requester.avatar,
            bio: requester.bio
        } : null;
    }).filter(r => r);
    res.json(requests);
});

app.get('/api/suggestions', requireAuth, (req, res) => {
    const users = readData('users');
    const currentUser = users[req.session.userId];
    const suggestions = Object.values(users)
        .filter(user =>
            user.id !== currentUser.id &&
            !(currentUser.friends || []).includes(user.id) &&
            !(currentUser.friendRequests || []).includes(user.id) &&
            !user.isBanned
        )
        .slice(0, 5)
        .map(user => ({
            id: user.id,
            username: user.username,
            avatar: user.avatar,
            bio: user.bio
        }));
    res.json(suggestions);
});

// ============ MESSAGING ROUTES ============
app.get('/api/messages/conversations', requireAuth, canAccessMessages, (req, res) => {
    const userId = req.session.userId;
    const messagesData = readMessages();
    const users = readData('users');
    const conversations = new Map();

    // Only get messages where current user is sender OR receiver
    messagesData.forEach(msg => {
        if (msg.from === userId || msg.to === userId) {
            const otherId = msg.from === userId ? msg.to : msg.from;
            if (!conversations.has(otherId) || new Date(msg.timestamp) > new Date(conversations.get(otherId).lastMessage.timestamp)) {
                const otherUser = users[otherId];
                if (otherUser && !otherUser.isBanned) {
                    conversations.set(otherId, {
                        userId: otherId,
                        username: otherUser.username,
                        avatar: otherUser.avatar,
                        lastMessage: msg,
                        unread: msg.to === userId && !msg.read ? (conversations.get(otherId)?.unread || 0) + 1 : 0
                    });
                }
            }
        }
    });

    res.json(Array.from(conversations.values()));
});

app.get('/api/messages/:userId', requireAuth, canAccessMessages, (req, res) => {
    const currentUserId = req.session.userId;
    const otherUserId = req.params.userId;
    const messagesData = readMessages();

    // ONLY get messages between current user and the specified user
    const userMessages = messagesData.filter(msg =>
        (msg.from === currentUserId && msg.to === otherUserId) ||
        (msg.from === otherUserId && msg.to === currentUserId)
    );

    // Mark messages as read - only for messages sent to current user
    let updated = false;
    messagesData.forEach(msg => {
        if (msg.to === currentUserId && msg.from === otherUserId && !msg.read) {
            msg.read = true;
            updated = true;
        }
    });
    if (updated) writeMessages(messagesData);

    res.json(userMessages);
});

app.post('/api/messages', requireAuth, (req, res) => {
    const { to, content, media, mediaType } = req.body;
    const users = readData('users');
    const fromUser = users[req.session.userId];

    if (!to || !content) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify the receiving user exists
    const toUser = users[to];
    if (!toUser) {
        return res.status(404).json({ error: 'User not found' });
    }

    const messagesData = readMessages();
    const message = {
        id: Date.now().toString(),
        from: req.session.userId,
        fromUsername: fromUser.username,
        fromAvatar: fromUser.avatar,
        to: to,
        toUsername: toUser.username,
        content: content,
        media: media || null,
        mediaType: mediaType || null,
        timestamp: new Date().toLocaleString(),
        read: false
    };

    messagesData.push(message);
    writeMessages(messagesData);

    // Only emit to the two users involved
    io.to(`user_${req.session.userId}`).emit('new_message', message);
    io.to(`user_${to}`).emit('new_message', message);

    res.json({ success: true, message });
});

// ============ ADMIN ROUTES ============
app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
    const users = readData('users');
    const userList = Object.values(users).map(user => ({
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        isBanned: user.isBanned,
        isSuspended: user.isSuspended,
        suspendedUntil: user.suspendedUntil,
        suspendReason: user.suspendReason,
        avatar: user.avatar,
        createdAt: user.createdAt
    }));
    res.json(userList);
});

app.get('/api/admin/all-posts', requireAuth, requireAdmin, (req, res) => {
    const posts = readData('posts');
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const start = (page - 1) * limit;
    const paginatedPosts = posts.slice(start, start + limit);
    res.json({
        posts: paginatedPosts,
        total: posts.length,
        page: page,
        totalPages: Math.ceil(posts.length / limit)
    });
});

app.put('/api/admin/posts/:postId', requireAuth, requireAdmin, (req, res) => {
    const { title, description } = req.body;
    const posts = readData('posts');
    const postIndex = posts.findIndex(p => p.id === req.params.postId);
    if (postIndex === -1) return res.status(404).json({ error: 'Post not found' });
    if (title) posts[postIndex].title = title;
    if (description !== undefined) posts[postIndex].description = description;
    writeData('posts', posts);
    res.json({ success: true, post: posts[postIndex] });
});

app.delete('/api/admin/posts/:postId', requireAuth, requireAdmin, (req, res) => {
    const posts = readData('posts');
    const postIndex = posts.findIndex(p => p.id === req.params.postId);
    if (postIndex === -1) return res.status(404).json({ error: 'Post not found' });
    const post = posts[postIndex];
    if (post.media) {
        const mediaPath = path.join(__dirname, post.media);
        if (fs.existsSync(mediaPath)) fs.unlinkSync(mediaPath);
    }
    posts.splice(postIndex, 1);
    writeData('posts', posts);
    res.json({ success: true });
});

app.post('/api/admin/make-admin/:userId', requireAuth, requireAdmin, (req, res) => {
    const users = readData('users');
    const targetUser = users[req.params.userId];
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    targetUser.role = 'admin';
    targetUser.isAdmin = true;
    writeData('users', users);
    res.json({ success: true, message: `${targetUser.username} is now an admin` });
});

app.post('/api/admin/remove-admin/:userId', requireAuth, requireAdmin, (req, res) => {
    const users = readData('users');
    const targetUser = users[req.params.userId];
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    if (targetUser.email === process.env.ADMIN_EMAIL) {
        return res.status(400).json({ error: 'Cannot remove super admin' });
    }
    targetUser.role = 'user';
    targetUser.isAdmin = false;
    writeData('users', users);
    res.json({ success: true });
});

app.post('/api/admin/suspend/:userId', requireAuth, requireAdmin, (req, res) => {
    const { duration, reason } = req.body;
    const users = readData('users');
    const targetUser = users[req.params.userId];
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    if (targetUser.email === process.env.ADMIN_EMAIL) {
        return res.status(400).json({ error: 'Cannot suspend super admin' });
    }
    const suspendUntil = new Date();
    suspendUntil.setHours(suspendUntil.getHours() + parseInt(duration));
    targetUser.isSuspended = true;
    targetUser.suspendedUntil = suspendUntil.toISOString();
    targetUser.suspendReason = reason || 'Violation of community guidelines';
    writeData('users', users);
    const socketId = userSockets.get(targetUser.id);
    if (socketId) {
        io.to(socketId).emit('account_suspended', { until: targetUser.suspendedUntil, reason: targetUser.suspendReason });
    }
    res.json({ success: true, message: `${targetUser.username} suspended for ${duration} hours` });
});

app.post('/api/admin/unsuspend/:userId', requireAuth, requireAdmin, (req, res) => {
    const users = readData('users');
    const targetUser = users[req.params.userId];
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    targetUser.isSuspended = false;
    targetUser.suspendedUntil = null;
    targetUser.suspendReason = null;
    writeData('users', users);
    res.json({ success: true, message: `${targetUser.username} has been unsuspended` });
});

app.post('/api/admin/ban/:userId', requireAuth, requireAdmin, (req, res) => {
    const users = readData('users');
    const targetUser = users[req.params.userId];
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    if (targetUser.email === process.env.ADMIN_EMAIL) {
        return res.status(400).json({ error: 'Cannot ban super admin' });
    }
    targetUser.isBanned = true;
    writeData('users', users);
    const socketId = userSockets.get(targetUser.id);
    if (socketId) {
        io.to(socketId).emit('account_banned');
    }
    res.json({ success: true, message: `${targetUser.username} has been banned` });
});

app.post('/api/admin/warn/:userId', requireAuth, requireAdmin, (req, res) => {
    const { warning } = req.body;
    const users = readData('users');
    const targetUser = users[req.params.userId];
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    if (!targetUser.warnings) targetUser.warnings = [];
    targetUser.warnings.push({
        id: Date.now().toString(),
        message: warning || 'Please follow community guidelines',
        issuedBy: req.session.userId,
        issuedAt: new Date().toLocaleString()
    });
    writeData('users', users);
    io.to(`user_${targetUser.id}`).emit('warning_issued', { message: warning });
    res.json({ success: true, message: `Warning issued to ${targetUser.username}` });
});

app.get('/api/admin/suspended-users', requireAuth, requireAdmin, (req, res) => {
    const users = readData('users');
    const suspendedUsers = Object.values(users).filter(user => user.isSuspended);
    res.json(suspendedUsers);
});

app.get('/api/admin/warnings', requireAuth, requireAdmin, (req, res) => {
    const users = readData('users');
    const allWarnings = [];
    Object.values(users).forEach(user => {
        if (user.warnings && user.warnings.length > 0) {
            allWarnings.push({
                userId: user.id,
                username: user.username,
                warnings: user.warnings
            });
        }
    });
    res.json(allWarnings);
});

app.get('/api/admin/user-activity/:userId', requireAuth, requireAdmin, (req, res) => {
    const userId = req.params.userId;
    const posts = readData('posts');
    const userPosts = posts.filter(p => p.authorId === userId);
    let userComments = [];
    posts.forEach(post => {
        post.comments.forEach(comment => {
            if (comment.userId === userId) {
                userComments.push({
                    postId: post.id,
                    postTitle: post.title,
                    comment: comment.comment,
                    createdAt: comment.createdAt
                });
            }
        });
    });
    res.json({
        totalPosts: userPosts.length,
        totalComments: userComments.length,
        posts: userPosts,
        comments: userComments
    });
});

// ============ HTML ROUTES ============
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/@:username', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ SOCKET.IO ============
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    socket.on('user_online', (userId) => {
        socket.join(`user_${userId}`);
        onlineUsers.set(userId, socket.id);
        userSockets.set(userId, socket.id);
        socket.userId = userId;
        const users = readData('users');
        const user = users[userId];
        if (user && user.friends) {
            user.friends.forEach(friendId => {
                io.to(`user_${friendId}`).emit('friend_status_change', { userId: userId, status: 'online' });
            });
        }
        console.log(`User ${userId} is online`);
    });

    socket.on('get_online_friends', () => {
        const userId = socket.userId;
        const users = readData('users');
        const currentUser = users[userId];
        if (currentUser && currentUser.friends) {
            const onlineFriendIds = currentUser.friends.filter(friendId => onlineUsers.has(friendId));
            socket.emit('online_friends', onlineFriendIds);
        }
    });

    // In io.on('connection') - update the send_message handler
    // REPLACE this entire socket.on('send_message') block:
    socket.on('send_message', (data) => {
        const { to, content, media, mediaType } = data;
        const from = socket.userId;

        if (!from || !to || !content) return;

        const users = readData('users');
        const fromUser = users[from];
        const toUser = users[to];

        if (!toUser) return;

        const message = {
            id: Date.now().toString(),
            from: from,
            fromUsername: fromUser.username,
            fromAvatar: fromUser.avatar,
            to: to,
            toUsername: toUser.username,
            content: content,
            media: media || null,
            mediaType: mediaType || null,
            timestamp: new Date().toLocaleString(),
            read: false
        };

        const messagesData = readMessages();
        messagesData.push(message);
        writeMessages(messagesData);

        // IMPORTANT: Only emit to sender and receiver, not everyone!
        io.to(`user_${from}`).emit('new_message', message);
        io.to(`user_${to}`).emit('new_message', message);

        socket.emit('message_sent', message);
    });

    socket.on('disconnect', () => {
        if (socket.userId) {
            onlineUsers.delete(socket.userId);
            userSockets.delete(socket.userId);
            const users = readData('users');
            const user = users[socket.userId];
            if (user && user.friends) {
                user.friends.forEach(friendId => {
                    io.to(`user_${friendId}`).emit('friend_status_change', { userId: socket.userId, status: 'offline' });
                });
            }
            console.log(`User ${socket.userId} disconnected`);
        }
    });
});

// Add this route to handle hashtag URLs
app.get('/hashtag/:tag', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ SEARCH API ============
app.get('/api/search', (req, res) => {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ users: [], posts: [] });

    const users = readData('users');
    const posts = readData('posts');
    const searchLower = q.toLowerCase();

    const matchedUsers = Object.values(users)
        .filter(user => !user.isBanned && user.username.toLowerCase().includes(searchLower))
        .slice(0, 5)
        .map(user => ({
            id: user.id,
            username: user.username,
            avatar: user.avatar,
            bio: user.bio
        }));

    const matchedPosts = posts
        .filter(post => post.title.toLowerCase().includes(searchLower) ||
            (post.description && post.description.toLowerCase().includes(searchLower)))
        .slice(0, 5)
        .map(post => ({
            id: post.id,
            title: post.title,
            author: post.author,
            createdAt: post.createdAt
        }));

    res.json({ users: matchedUsers, posts: matchedPosts });
});

// Reel upload route
// ============ REEL ROUTES - COMPLETE ============

// Create reel
app.post('/api/reels', requireAuth, uploadReel.single('video'), (req, res) => {
    const { title, description } = req.body;
    
    if (!req.file) {
        return res.status(400).json({ error: 'Video is required' });
    }
    
    const users = readData('users');
    const user = users[req.session.userId];
    const reels = readData('reels');
    
    // Make sure the video URL is correct
    const videoUrl = `/uploads/reels/${req.file.filename}`;
    
    const newReel = {
        id: Date.now().toString(),
        title: title || 'Untitled Reel',
        description: description || '',
        video: videoUrl,
        video_url: videoUrl, // Add both for compatibility
        author: user.username,
        authorId: user.id,
        authorAvatar: user.avatar,
        createdAt: new Date().toLocaleString(),
        likes: 0,
        likedBy: [],
        comments: [],
        views: 0
    };
    
    reels.unshift(newReel);
    writeData('reels', reels);
    
    res.json({ 
        success: true, 
        reel: newReel,
        message: 'Reel created successfully!'
    });
});

// Get all reels
app.get('/api/reels', (req, res) => {
    const reels = readData('reels');
    const currentUserId = req.session.userId;

    const reelsWithStatus = reels.map(reel => ({
        ...reel,
        isLiked: currentUserId ? reel.likedBy.includes(currentUserId) : false
    }));

    res.json(reelsWithStatus);
});

// Like reel
app.post('/api/reels/:id/like', requireAuth, (req, res) => {
    const reels = readData('reels');
    const reelIndex = reels.findIndex(r => r.id === req.params.id);

    if (reelIndex === -1) return res.status(404).json({ error: 'Reel not found' });

    const reel = reels[reelIndex];
    const userId = req.session.userId;

    if (reel.likedBy.includes(userId)) {
        reel.likedBy = reel.likedBy.filter(id => id !== userId);
        reel.likes--;
    } else {
        reel.likedBy.push(userId);
        reel.likes++;
    }

    writeData('reels', reels);
    res.json({ success: true, likes: reel.likes, isLiked: reel.likedBy.includes(userId) });
});

// View reel (increment view count)
app.post('/api/reels/:id/view', (req, res) => {
    const reels = readData('reels');
    const reel = reels.find(r => r.id === req.params.id);
    if (reel) {
        reel.views++;
        writeData('reels', reels);
    }
    res.json({ success: true });
});

// ============ ALGORITHMIC FEED ============

// Track user hashtag views
app.post('/api/track/hashtag', requireAuth, (req, res) => {
    const { hashtag } = req.body;
    const userId = req.session.userId;
    let hashtagPrefs = readData('hashtag_preferences');
    if (!hashtagPrefs[userId]) hashtagPrefs[userId] = {};
    if (!hashtagPrefs[userId][hashtag]) hashtagPrefs[userId][hashtag] = 0;
    hashtagPrefs[userId][hashtag]++;
    writeData('hashtag_preferences', hashtagPrefs);
    res.json({ success: true });
});

// Get personalized feed
app.get('/api/feed/personalized', requireAuth, (req, res) => {
    let posts = readData('posts');
    const userId = req.session.userId;
    const users = readData('users');
    const currentUser = users[userId];
    const hashtagPrefs = readData('hashtag_preferences') || {};
    const userPrefs = hashtagPrefs[userId] || {};

    // Calculate post scores
    const scoredPosts = posts.map(post => {
        let score = 0;

        // Extract hashtags from post
        const content = (post.title + ' ' + (post.description || '')).toLowerCase();
        const hashtags = content.match(/#\w+/g) || [];

        // Score based on user's hashtag preferences (40% weight)
        hashtags.forEach(tag => {
            score += (userPrefs[tag] || 0) * 2;
        });

        // Score based on follow (30% weight)
        if (currentUser.friends?.includes(post.authorId)) {
            score += 30;
        }

        // Score based on engagement (20% weight)
        score += (post.likes || 0) * 0.1;
        score += (post.comments?.length || 0) * 0.2;

        // Score based on recency (10% weight)
        const age = Date.now() - new Date(post.createdAt).getTime();
        const daysOld = age / (1000 * 60 * 60 * 24);
        score += Math.max(0, 10 - daysOld);

        return { post, score };
    });

    // Sort by score and add random factor (±5% variation)
    scoredPosts.sort((a, b) => {
        const randomFactor = 0.95 + Math.random() * 0.1;
        return (b.score * randomFactor) - (a.score);
    });

    const personalizedPosts = scoredPosts.map(item => ({
        ...item.post,
        isLiked: (item.post.likedBy || []).includes(userId),
        isAuthor: item.post.authorId === userId
    }));

    res.json(personalizedPosts);
});

// Add this to your HTML routes
app.get('/reels', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/@:username', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/hashtag/:tag', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ REELS FEED API ============
app.get('/api/reels/feed', async (req, res) => {
    const cursor = req.query.cursor;
    const limit = parseInt(req.query.limit) || 5;
    let reels = readData('reels');
    const currentUserId = req.session.userId;
    const users = readData('users');

    // Sort by newest first
    reels.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Pagination
    let startIndex = 0;
    if (cursor) {
        const index = reels.findIndex(r => r.id === cursor);
        if (index !== -1) startIndex = index + 1;
    }

    const paginatedReels = reels.slice(startIndex, startIndex + limit);
    const nextCursor = paginatedReels.length === limit ? paginatedReels[paginatedReels.length - 1].id : null;

    // Add user-specific data
    const currentUser = users[currentUserId];

    const reelsWithMeta = paginatedReels.map(reel => {
        const author = users[reel.authorId];
        return {
            ...reel,
            video_url: reel.video_url || reel.video, // Ensure video_url exists
            isLiked: reel.likedBy?.includes(currentUserId) || false,
            isFollowing: currentUser?.friends?.includes(reel.authorId) || false,
            author_avatar: author?.avatar,
            author: author?.username,
            user_id: reel.authorId,
            likes_count: reel.likes || 0,
            comments_count: reel.comments?.length || 0
        };
    });

    res.json({
        reels: reelsWithMeta,
        nextCursor: nextCursor,
        hasMore: paginatedReels.length === limit
    });
});

// Add comment to reel
app.post('/api/reels/:id/comment', requireAuth, (req, res) => {
    const { comment } = req.body;
    const reels = readData('reels');
    const reelIndex = reels.findIndex(r => r.id === req.params.id);

    if (reelIndex === -1) return res.status(404).json({ error: 'Reel not found' });

    const users = readData('users');
    const user = users[req.session.userId];

    const newComment = {
        id: Date.now().toString(),
        userId: user.id,
        username: user.username,
        avatar: user.avatar,
        comment: comment,
        createdAt: new Date().toLocaleString()
    };

    if (!reels[reelIndex].comments) reels[reelIndex].comments = [];
    reels[reelIndex].comments.push(newComment);
    writeData('reels', reels);

    res.json({ success: true, comment: newComment });
});

// Debug middleware - add this after session configuration
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url} - Session: ${req.session.userId || 'No session'}`);
    next();
});


// ============ GET SINGLE REEL BY ID ============
app.get('/api/reels/:id', (req, res) => {
    const reels = readData('reels');
    const reel = reels.find(r => r.id === req.params.id);
    
    if (!reel) {
        return res.status(404).json({ error: 'Reel not found' });
    }
    
    const users = readData('users');
    const currentUserId = req.session.userId;
    const author = users[reel.authorId];
    
    res.json({
        ...reel,
        author_avatar: author?.avatar,
        author: author?.username,
        isLiked: currentUserId ? reel.likedBy?.includes(currentUserId) : false,
        likes_count: reel.likes || 0,
        comments_count: reel.comments?.length || 0
    });
});


// Add this route to serve the reel page
app.get('/reel/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Add these routes to server.js if not already present
app.get('/post/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/reel/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});





// Start server
initAdmin().then(() => {
    server.listen(PORT, () => {
        console.log(`\n🚀 Social Vault Complete is running!`);
        console.log(`📱 http://localhost:${PORT}`);
        console.log(`✨ Share and celebrate the things you love!\n`);
    });
});