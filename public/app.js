// ============ GLOBAL VARIABLES ============
let currentUser = null;
let currentFilter = 'all';
let currentView = 'feed';
let socket = null;
let currentCall = null;
let localStream = null;
let peerConnection = null;
let currentChatUser = null;
let currentGroup = null;
let onlineFriends = new Map();
let activeModal = null;
let currentPage = 1;
let isLoadingMore = false;
let hasMorePosts = true;
let selectedMediaFiles = [];
let reelObservers = [];
let isLoadingReels = false;
let hasMoreReels = true;
let reelCursor = null;

// Configuration
const CONFIG = {
    ICE_SERVERS: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    }
};

// Cache DOM elements
const DOM = {
    feedContainer: null,
    loading: null,
    toastContainer: null,
    mainApp: null
};

function initDOMCache() {
    DOM.feedContainer = document.getElementById('feedContainer');
    DOM.loading = document.getElementById('loading');
    DOM.toastContainer = document.getElementById('toastContainer');
    DOM.mainApp = document.getElementById('mainApp');
}

// ============ INITIALIZATION ============
document.addEventListener('DOMContentLoaded', async () => {
    loadTheme();
    initDOMCache();
    await checkAuth();
});

// Check authentication
async function checkAuth() {
    showLoading();
    try {
        const response = await fetch('/api/me');
        if (response.ok) {
            const data = await response.json();
            currentUser = data.user;
            console.log('User authenticated:', currentUser.username);

            showMainApp();
            initMobileFeatures();
            setupSocket();

            await loadTrendingHashtags();

            // Check if this is a shared post/reel link
            const isSharedContent = await handleSharedContent();

            if (!isSharedContent) {
                // Handle routing based on URL
                const path = window.location.pathname;

                if (path === '/reels') {
                    await navigateToPage('/reels', false);
                } else if (path === '/' || path === '') {
                    await navigateToPage('/', false);
                } else if (path.startsWith('/@')) {
                    await navigateToPage(path, false);
                } else if (path.startsWith('/hashtag/')) {
                    await navigateToPage(path, false);
                } else {
                    await navigateToPage('/', false);
                }
            }

            setupEventListeners();
            setupInfiniteScroll();

            if (socket) {
                socket.emit('user_online', currentUser.id);
            }

            if (currentUser.role === 'admin') {
                const adminMenu = document.getElementById('adminMenuLink');
                if (adminMenu) adminMenu.style.display = 'block';
                const mobileAdminMenu = document.getElementById('mobileAdminMenu');
                if (mobileAdminMenu) mobileAdminMenu.style.display = 'block';
            }
        } else {
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('Auth check error:', error);
        window.location.href = '/login';
    }
    hideLoading();
}

// Handle popstate for back/forward buttons
window.addEventListener('popstate', async () => {
    const path = window.location.pathname;
    await navigateToPage(path, false);
});

function updateActiveMenuItems() {
    // Update sidebar menu
    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.remove('active');
        const view = item.getAttribute('data-view');
        if ((currentView === 'feed' && view === 'feed') ||
            (currentView === 'reels' && view === 'reels')) {
            item.classList.add('active');
        }
    });

    // Update bottom navigation
    document.querySelectorAll('.bottom-nav-item').forEach(item => {
        item.classList.remove('active');
        const nav = item.getAttribute('data-nav');
        if ((currentView === 'feed' && nav === 'feed') ||
            (currentView === 'reels' && nav === 'reels')) {
            item.classList.add('active');
        }
    });
}

// Setup Socket.io
function setupSocket() {
    socket = io();

    socket.on('connect', () => {
        console.log('Socket connected');
        if (currentUser) {
            socket.emit('user_online', currentUser.id);
            socket.emit('get_online_friends');
        }
    });

    socket.on('online_friends', (friendIds) => {
        onlineFriends.clear();
        friendIds.forEach(id => onlineFriends.set(id, true));
        loadOnlineFriends();
        loadFriendsCompact();
    });

    socket.on('user_online_status', (data) => {
        onlineFriends.set(data.userId, data.isOnline);
        loadOnlineFriends();
        loadFriendsCompact();
        if (currentChatUser === data.userId) {
            const statusDiv = document.querySelector('.chat-status');
            if (statusDiv) {
                statusDiv.textContent = data.isOnline ? '🟢 Online' : '⚫ Offline';
                statusDiv.className = data.isOnline ? 'chat-status online' : 'chat-status offline';
            }
        }
    });

    socket.on('new_message', (message) => {
        if (currentChatUser === message.from) {
            appendMessage(message);
        }
        loadConversations();
        updateMessageBadge();
        showToast('New message from ' + message.fromUsername, 'info');
    });

    socket.on('friend_request', (request) => {
        showToast(`Friend request from ${request.fromUsername}`, 'info');
        loadFriendRequestsCount();
        loadFriendRequestsCompact();
    });

    socket.on('friend_accepted', async (data) => {
        showToast(`${data.username} accepted your friend request!`, 'success');
        await loadFriends();
        await loadFriendsCompact();
        await loadSuggestions();
        await loadFriendRequestsCompact();
        if (socket) socket.emit('get_online_friends');
    });

    // Add this inside setupSocket() function
    socket.on('avatar_updated', (data) => {
        if (data.userId === currentUser?.id) {
            // Update current user's avatar
            currentUser.avatar = data.avatar;

            // Update navbar avatar
            const navAvatar = document.getElementById('navAvatar');
            if (navAvatar) navAvatar.src = data.avatar;

            // Update mobile menu avatar
            const mobileMenuAvatar = document.getElementById('mobileMenuAvatar');
            if (mobileMenuAvatar) mobileMenuAvatar.src = data.avatar;

            // Update all avatars in the current feed
            document.querySelectorAll('.post-avatar, .comment-avatar, .reel-author-avatar, .friend-avatar, .suggestion-avatar, .online-avatar, .chat-avatar, .message-avatar').forEach(img => {
                if (img.src && img.src.includes(currentUser?.username)) {
                    // Only update if it matches current user
                    const parent = img.closest('.post-card, .comment, .reel-card');
                    if (parent) {
                        // Check if this avatar belongs to current user
                        const authorName = parent.querySelector('.post-author, .comment-author, .reel-author-name')?.innerText;
                        if (authorName === currentUser?.username) {
                            img.src = data.avatar;
                        }
                    }
                }
            });

            showCustomAlert('Profile picture updated!', 'success');
        }
    });
}

// ============ UI HELPERS ============
function showLoading() {
    const loading = document.getElementById('loading');
    if (loading) loading.style.display = 'flex';
}

function hideLoading() {
    const loading = document.getElementById('loading');
    if (loading) loading.style.display = 'none';
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
        <span>${message}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showMainApp() {
    if (DOM.mainApp) DOM.mainApp.style.display = 'block';
    const avatarUrl = currentUser?.avatar || `https://ui-avatars.com/api/?name=${currentUser?.username}&background=2563eb&color=fff&size=40`;
    const navAvatar = document.getElementById('navAvatar');
    if (navAvatar) navAvatar.src = avatarUrl;

    // Initialize search
    setupSearch();

    // Update mobile menu
    updateMobileMenu();
}

// ============ DARK MODE ============
function toggleDarkMode() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    if (currentTheme === 'dark') {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
        const icon = document.getElementById('darkModeIcon');
        if (icon) icon.className = 'fas fa-moon';
    } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
        const icon = document.getElementById('darkModeIcon');
        if (icon) icon.className = 'fas fa-sun';
    }
}

function loadTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        const icon = document.getElementById('darkModeIcon');
        if (icon) icon.className = 'fas fa-sun';
    }
}

// ============ NAVIGATION ============
// ============ FIXED NAVIGATION WITH PROPER URLS ============

// Navigate to home (feed)
function goHome() {
    quickLoad('/');
}

// Navigate to profile
function goToProfile(username) {
    window.location.href = `/@${username}`;
}

// Navigate to hashtag
function goToHashtag(tag) {
    window.location.href = `/hashtag/${tag}`;
}

// Update viewProfile function to change URL
// ============ FIXED PROFILE WITH URL UPDATE ============
// ============ FIXED VIEW PROFILE WITH WORKING CLOSE BUTTON ============
async function viewProfile(username, updateHistory = true) {
    const newUrl = `/@${username}`;
    if (updateHistory) {
        window.history.pushState({}, '', newUrl);
    }
    document.title = `${username} | Social Vault`;
    currentView = 'profile';

    showLoading();
    try {
        const response = await fetch(`/api/@${username}`);
        const data = await response.json();

        if (data.user) {
            const modal = document.getElementById('profileModal');
            const content = document.getElementById('profileContent');
            const isOwnProfile = currentUser?.username === username;

            let isFollowing = false;
            if (currentUser && !isOwnProfile) {
                const friendsList = await getFriendsList();
                isFollowing = friendsList.some(f => f.id === data.user.id);
            }

            content.innerHTML = `
                <div class="profile-view">
                    <div class="profile-cover-area">
                        ${data.user.coverPhoto ? 
                            `<img src="${data.user.coverPhoto}?t=${Date.now()}" class="profile-cover" alt="Cover">` : 
                            '<div class="profile-cover-placeholder"></div>'
                        }
                        ${isOwnProfile ? `
                            <button class="edit-cover-btn" onclick="document.getElementById('coverInput').click()">
                                <i class="fas fa-camera"></i> Edit Cover
                            </button>
                        ` : ''}
                    </div>
                    <div class="profile-avatar-large">
                        <img src="${data.user.avatar || `https://ui-avatars.com/api/?name=${data.user.username}&background=2563eb&color=fff&size=120`}?t=${Date.now()}" 
                             alt="${data.user.username}"
                             onerror="this.src='https://ui-avatars.com/api/?name=${data.user.username}&background=2563eb&color=fff&size=120'">
                        ${isOwnProfile ? `
                            <button class="edit-avatar-btn" onclick="document.getElementById('avatarInput').click()">
                                <i class="fas fa-camera"></i>
                            </button>
                        ` : ''}
                    </div>
                    <div class="profile-info">
                        <h2>${escapeHtml(data.user.username)}</h2>
                        <p class="profile-bio">${escapeHtml(data.user.bio || 'No bio yet')}</p>
                        <div class="profile-stats">
                            <div><strong>${data.user.friends?.length || 0}</strong> Friends</div>
                            <div><strong>${data.posts?.length || 0}</strong> Posts</div>
                            <div><strong>${data.reels?.length || 0}</strong> Reels</div>
                        </div>
                        ${!isOwnProfile ? `
                            <div class="profile-actions">
                                ${!isFollowing ?
                                    `<button class="btn-primary" onclick="sendFriendRequest('${data.user.id}')">Add Friend</button>` :
                                    `<button class="btn-secondary" onclick="removeFriend('${data.user.id}')">Unfriend</button>`
                                }
                                <button class="btn-primary" onclick="startChat('${data.user.id}')">Message</button>
                            </div>
                        ` : `
                            <button class="btn-secondary" onclick="openSettings()">Edit Profile</button>
                        `}
                    </div>
                    <div class="profile-posts">
                        <h3>Posts</h3>
                        ${data.posts.length === 0 ? '<p>No posts yet</p>' :
                            data.posts.map(post => `
                                <div class="mini-post" onclick="viewPost('${post.id}')">
                                    <div class="post-title">${escapeHtml(post.title)}</div>
                                    <div class="post-time">${getTimeAgo(post.createdAt)}</div>
                                </div>
                            `).join('')
                        }
                    </div>
                </div>
            `;

            openModal('profileModal');
        }
    } catch (error) {
        console.error('Error loading profile:', error);
        showCustomAlert('Failed to load profile', 'error');
    }
    hideLoading();
}

// Close profile modal and go back to home URL
function closeProfileModal() {
    closeModal('profileModal');
    // Reset URL to home
    if (window.location.pathname.startsWith('/@')) {
        window.history.pushState({}, '', '/');
    }
}

// Update navigateTo function for home
// ============ NAVIGATION ============
function navigateTo(view) {
    currentView = view;
    document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
    const activeItem = document.querySelector(`.menu-item[data-view="${view}"]`);
    if (activeItem) activeItem.classList.add('active');

    switch (view) {
        case 'feed':
            window.location.href = '/';
            break;
        case 'reels':
            window.location.href = '/reels';
            break;
        case 'friends':
            openFriends();
            break;
    }
}

// Update handleHashtag function
// ============ FIXED HASHTAG HANDLER - NO PAGE RELOAD ============
function handleHashtag(hashtag, event) {
    if (event) event.stopPropagation();
    const tag = hashtag.startsWith('#') ? hashtag.substring(1) : hashtag;

    // Update URL without reload
    const newUrl = `/hashtag/${tag}`;
    window.history.pushState({}, '', newUrl);
    document.title = `#${tag} | Social Vault`;

    // Load hashtag posts without page reload
    loadPostsByHashtag(tag);
}

// Update loadPostsByHashtag to handle URL
// ============ FAST HASHTAG POSTS LOADING ============
async function loadPostsByHashtag(hashtag) {
    showLoading();
    try {
        const response = await fetch(`/api/hashtag/${hashtag}`);
        const posts = await response.json();
        const container = document.getElementById('feedContainer');
        if (!container) return;

        // Update the main content area
        if (posts.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-hashtag"></i>
                    <h3>No posts found with #${escapeHtml(hashtag)}</h3>
                    <p>Be the first to post using this hashtag!</p>
                    <button class="btn-primary" onclick="openCreatePostModal()">Create Post</button>
                </div>
            `;
            hideLoading();
            return;
        }

        container.innerHTML = `
            <div class="hashtag-header">
                <h2><i class="fas fa-hashtag"></i> ${escapeHtml(hashtag)}</h2>
                <p>${posts.length} posts found</p>
                <button class="btn-small" onclick="goHome()">← Back to Home</button>
            </div>
            <div class="create-post-card" onclick="openCreatePostModal()">
                <img src="${currentUser?.avatar || `https://ui-avatars.com/api/?name=${currentUser?.username}&background=2563eb&color=fff`}" class="create-post-avatar">
                <div class="create-post-placeholder">What's on your mind, ${currentUser?.username}?</div>
            </div>
            ${posts.map(post => createPostHTML(post)).join('')}
        `;

        // Update active states
        document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
        document.querySelector('.menu-item[data-view="feed"]')?.classList.add('active');
        currentView = 'feed';

    } catch (error) {
        console.error('Error loading hashtag posts:', error);
        showToast('Failed to load posts', 'error');
    }
    hideLoading();
}

// ============ FEED ============
async function loadFeed(loadMore = false) {
    if (isLoadingMore) return;

    if (!loadMore) {
        currentPage = 1;
        hasMorePosts = true;
        showLoading();
    } else {
        if (!hasMorePosts) return;
        isLoadingMore = true;
    }

    try {
        // Use personalized feed endpoint
        const response = await fetch('/api/feed/personalized');
        const posts = await response.json();

        if (loadMore) {
            appendPosts(posts);
        } else {
            renderFeed(posts);
        }

        hasMorePosts = posts.length === 10;
        if (hasMorePosts) currentPage++;
    } catch (error) {
        console.error('Error loading feed:', error);
        showToast('Failed to load feed', 'error');
    }

    if (!loadMore) hideLoading();
    isLoadingMore = false;
}

function appendPosts(posts) {
    const container = document.getElementById('feedContainer');
    if (!container) return;
    const postsHTML = posts.map(post => createPostHTML(post)).join('');
    container.insertAdjacentHTML('beforeend', postsHTML);
}

function renderFeed(posts) {
    const container = document.getElementById('feedContainer');
    if (!container) return;

    if (posts.length === 0) {
        container.innerHTML = `
            <div class="create-post-card" onclick="openCreatePostModal()">
                <img src="${currentUser?.avatar || `https://ui-avatars.com/api/?name=${currentUser?.username}&background=2563eb&color=fff`}" class="create-post-avatar">
                <div class="create-post-placeholder">What's on your mind, ${currentUser?.username}?</div>
            </div>
            <div class="empty-state">
                <i class="fas fa-vault"></i>
                <h3>No posts yet</h3>
                <p>Be the first to share something!</p>
                <button class="btn-primary" onclick="openCreatePostModal()">Create Post</button>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="create-post-card" onclick="openCreatePostModal()">
            <img src="${currentUser?.avatar || `https://ui-avatars.com/api/?name=${currentUser?.username}&background=2563eb&color=fff`}" class="create-post-avatar">
            <div class="create-post-placeholder">What's on your mind, ${currentUser?.username}?</div>
        </div>
        ${posts.map(post => createPostHTML(post)).join('')}
    `;
}

function createPostHTML(post) {
    const timeAgo = getTimeAgo(post.createdAt);
    let mediaHTML = '';

    if (post.media) {
        if (Array.isArray(post.media) && post.media.length > 0) {
            const hasVideo = post.media.some(item => {
                const url = typeof item === 'string' ? item : item.url;
                return url && url.match(/\.(mp4|mov|avi|webm)$/i);
            });

            if (hasVideo) {
                mediaHTML = `
                    <div style="display: flex; flex-direction: column; gap: 0.5rem; padding: 0 1rem;">
                        ${post.media.map((item) => {
                    const mediaUrl = typeof item === 'string' ? item : item.url;
                    const isVideo = mediaUrl && mediaUrl.match(/\.(mp4|mov|avi|webm)$/i);
                    if (isVideo) {
                        return `<video src="${mediaUrl}" class="post-media" controls preload="none" onclick="event.stopPropagation()"></video>`;
                    } else {
                        return `<img src="${mediaUrl}" class="post-media" loading="lazy" alt="Media" style="cursor: pointer;" onclick="viewImage('${mediaUrl}', event)">`;
                    }
                }).join('')}
                    </div>
                `;
            } else {
                mediaHTML = `
                    <div class="post-media-grid">
                        ${post.media.map((item) => {
                    const mediaUrl = typeof item === 'string' ? item : item.url;
                    return `
                                <div class="post-media-item">
                                    <img src="${mediaUrl}" loading="lazy" alt="Media" style="width: 100%; height: 200px; object-fit: cover; cursor: pointer;" onclick="viewImage('${mediaUrl}', event)">
                                </div>
                            `;
                }).join('')}
                    </div>
                `;
            }
        } else if (typeof post.media === 'string' && post.media) {
            const isVideo = post.media.match(/\.(mp4|mov|avi|webm)$/i);
            if (isVideo) {
                mediaHTML = `<video src="${post.media}" class="post-media" controls preload="none" onclick="event.stopPropagation()"></video>`;
            } else {
                mediaHTML = `<img src="${post.media}" class="post-media" loading="lazy" alt="Post media" style="cursor: pointer;" onclick="viewImage('${post.media}', event)">`;
            }
        }
    }

    return `
        <div class="post-card" data-post-id="${post.id}">
            <div class="post-header" onclick="viewProfile('${post.author}')">
                <img src="${post.authorAvatar || `https://ui-avatars.com/api/?name=${post.author}&background=2563eb&color=fff`}" 
                    class="post-avatar" 
                    loading="lazy"
                    data-user-id="${post.authorId}"
                    onerror="this.src='https://ui-avatars.com/api/?name=${post.author}&background=2563eb&color=fff'">
                <div class="post-author-info">
                    <div class="post-author">${escapeHtml(post.author)}</div>
                    <div class="post-time">${timeAgo}</div>
                </div>
                ${post.isAuthor ? `<button class="post-menu" onclick="event.stopPropagation(); deletePost('${post.id}')"><i class="fas fa-trash"></i></button>` : ''}
            </div>
            <div class="post-title" onclick="viewPost('${post.id}')">${escapeHtml(post.title)}</div>
            ${post.description ? `<div class="post-description" onclick="viewPost('${post.id}')">${escapeHtml(post.description)}</div>` : ''}
            ${mediaHTML}
            <div class="post-stats">
                <span><i class="fas fa-heart"></i> ${post.likes || 0}</span>
                <span><i class="fas fa-comment"></i> ${post.comments?.length || 0}</span>
                <span><i class="fas fa-share"></i> ${post.shares || 0}</span>
            </div>
            <div class="post-actions">
                <button class="action-btn ${post.isLiked ? 'liked' : ''}" onclick="likePost('${post.id}')">
                    <i class="fas fa-heart"></i> ${post.isLiked ? 'Liked' : 'Like'}
                </button>
                <button class="action-btn" onclick="viewPost('${post.id}')">
                    <i class="fas fa-comment"></i> Comment
                </button>
                <button class="action-btn" onclick="sharePostToFriend('${post.id}')">
                    <i class="fas fa-share-alt"></i> Share
                </button>
            </div>
        </div>
    `;
}

async function likePost(postId) {
    try {
        const response = await fetch(`/api/posts/${postId}/like`, { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            await loadFeed();
        }
    } catch (error) {
        console.error('Error liking post:', error);
    }
}

async function deletePost(postId) {
    if (!confirm('Are you sure you want to delete this post? This action cannot be undone.')) return;

    showLoading();
    try {
        const response = await fetch(`/api/posts/${postId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (data.success) {
            showToast('Post deleted successfully!', 'success');
            await loadFeed();
        } else {
            showToast(data.error || 'Failed to delete post', 'error');
        }
    } catch (error) {
        console.error('Error deleting post:', error);
        showToast('Failed to delete post. Please try again.', 'error');
    }
    hideLoading();
}

async function copyPostLink(postId) {
    const url = `${window.location.origin}/post/${postId}`;
    await navigator.clipboard.writeText(url);
    showToast('Link copied!', 'success');
}

// ============ IMAGE VIEWER ============
function viewImage(imageUrl, event) {
    if (event) event.stopPropagation();

    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.95);
        z-index: 10000;
        display: flex;
        justify-content: center;
        align-items: center;
        cursor: pointer;
    `;

    const img = document.createElement('img');
    img.src = imageUrl;
    img.style.cssText = `
        max-width: 90%;
        max-height: 90%;
        object-fit: contain;
        border-radius: 8px;
    `;

    modal.appendChild(img);
    document.body.appendChild(modal);

    modal.onclick = function () {
        modal.remove();
    };

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && document.body.contains(modal)) {
            modal.remove();
        }
    });
}

// ============ VIEW POST ============
async function viewPost(postId) {
    showLoading();
    try {
        const response = await fetch(`/api/posts/${postId}`);
        const post = await response.json();

        let mediaHTML = '';
        if (post.media) {
            if (Array.isArray(post.media) && post.media.length > 0) {
                mediaHTML = `
                    <div class="post-media-grid">
                        ${post.media.map((item) => {
                    const mediaUrl = typeof item === 'string' ? item : item.url;
                    return `
                                <div class="post-media-item">
                                    <img src="${mediaUrl}" style="width:100%;cursor:pointer;" onclick="viewImage('${mediaUrl}', event)">
                                </div>
                            `;
                }).join('')}
                    </div>
                `;
            } else if (typeof post.media === 'string' && post.media) {
                mediaHTML = `<img src="${post.media}" style="width:100%;cursor:pointer;" onclick="viewImage('${post.media}', event)">`;
            }
        }

        const modal = document.getElementById('postModal');
        const content = document.getElementById('postDetailContent');

        content.innerHTML = `
            <div class="post-card" style="margin: 0; box-shadow: none;">
                <div class="post-header">
                    <img src="${post.authorAvatar || `https://ui-avatars.com/api/?name=${post.author}&background=2563eb&color=fff`}" class="post-avatar" onclick="viewProfile('${post.author}')">
                    <div class="post-author-info">
                        <div class="post-author" onclick="viewProfile('${post.author}')">${escapeHtml(post.author)}</div>
                        <div class="post-time">${getTimeAgo(post.createdAt)}</div>
                    </div>
                    <button class="close-btn" onclick="closePostModal()" style="background: none; border: none; font-size: 1.2rem; cursor: pointer;">&times;</button>
                </div>
                <div class="post-title">${escapeHtml(post.title)}</div>
                ${post.description ? `<div class="post-description">${escapeHtml(post.description)}</div>` : ''}
                ${mediaHTML}
                <div class="post-stats">
                    <span><i class="fas fa-heart"></i> ${post.likes || 0}</span>
                    <span><i class="fas fa-comment"></i> ${post.comments?.length || 0}</span>
                    <span><i class="fas fa-share"></i> ${post.shares || 0}</span>
                </div>
                <div class="post-actions">
                    <button class="action-btn ${post.isLiked ? 'liked' : ''}" onclick="likePost('${post.id}'); setTimeout(() => viewPost('${post.id}'), 500)">
                        <i class="fas fa-heart"></i> ${post.isLiked ? 'Liked' : 'Like'}
                    </button>
                    <button class="action-btn" onclick="sharePostToFriend('${post.id}')">
                        <i class="fas fa-share-alt"></i> Share
                    </button>
                </div>
                <div class="comments-section">
                    <h4>Comments (${post.comments?.length || 0})</h4>
                    <div id="commentsList">
                        // In viewPost function, when rendering comments
                        ${post.comments?.map(comment => `
                            <div class="comment">
                                <img src="${comment.avatar || `https://ui-avatars.com/api/?name=${comment.username}&background=64748b&color=fff`}" 
                                    class="comment-avatar" 
                                    onclick="viewProfile('${comment.username}')"
                                    data-user-id="${comment.userId}">
                                <div class="comment-content">
                                    <div class="comment-author" onclick="viewProfile('${comment.username}')">${escapeHtml(comment.username)}</div>
                                    <div class="comment-text">${escapeHtml(comment.comment)}</div>
                                    <div class="comment-time">${getTimeAgo(comment.createdAt)}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    <div class="add-comment">
                        <input type="text" id="newCommentInput" placeholder="Write a comment..." onkeypress="if(event.key==='Enter') submitComment('${post.id}')">
                        <button class="btn-primary" onclick="submitComment('${post.id}')">Post</button>
                    </div>
                </div>
            </div>
        `;

        openModal('postModal');
    } catch (error) {
        console.error('Error loading post:', error);
        showToast('Failed to load post', 'error');
    }
    hideLoading();
}

async function submitComment(postId) {
    const commentInput = document.getElementById('newCommentInput');
    const comment = commentInput?.value.trim();
    if (!comment) {
        showToast('Please enter a comment', 'error');
        return;
    }

    try {
        const response = await fetch(`/api/posts/${postId}/comment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ comment })
        });
        const data = await response.json();
        if (data.success) {
            commentInput.value = '';
            await viewPost(postId);
            await loadFeed();
            showToast('Comment added!', 'success');
        }
    } catch (error) {
        console.error('Error adding comment:', error);
        showToast('Failed to add comment', 'error');
    }
}

// ============ PROFILE ============

// ============ FRIEND FUNCTIONS ============
async function sendFriendRequest(userId) {
    try {
        const response = await fetch(`/api/friends/request/${userId}`, { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            showToast('Friend request sent!', 'success');
            closeProfileModal();
        }
    } catch (error) {
        console.error('Error:', error);
        showToast('Failed to send request', 'error');
    }
}

async function acceptFriendRequest(userId) {
    try {
        const response = await fetch(`/api/friends/accept/${userId}`, { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            showToast('Friend added!', 'success');
            await loadFriendsCompact();
            await loadFriendRequestsCompact();
            await loadSuggestions();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function declineFriendRequest(userId) {
    try {
        const response = await fetch(`/api/friends/decline/${userId}`, { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            showToast('Request declined', 'info');
            await loadFriendRequestsCompact();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function removeFriend(userId) {
    if (!confirm('Remove this friend?')) return;
    try {
        const response = await fetch(`/api/friends/remove/${userId}`, { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            showToast('Friend removed', 'info');
            await loadFriendsCompact();
            await loadSuggestions();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function getFriendsList() {
    try {
        const response = await fetch('/api/friends');
        return await response.json();
    } catch (error) {
        return [];
    }
}

async function loadSuggestions() {
    try {
        const response = await fetch('/api/suggestions');
        const suggestions = await response.json();
        const container = document.getElementById('suggestionsList');
        if (!container) return;

        if (suggestions.length === 0) {
            container.innerHTML = '<p>No suggestions</p>';
            return;
        }

        container.innerHTML = suggestions.map(user => `
            <div class="suggestion-item" onclick="viewProfile('${user.username}')">
                <img src="${user.avatar || `https://ui-avatars.com/api/?name=${user.username}&background=2563eb&color=fff`}" class="suggestion-avatar">
                <div class="suggestion-info">
                    <div class="suggestion-name">${escapeHtml(user.username)}</div>
                </div>
                <button class="follow-btn" onclick="event.stopPropagation(); sendFriendRequest('${user.id}')">Add</button>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error:', error);
    }
}

async function loadOnlineFriends() {
    const friends = await getFriendsList();
    const container = document.getElementById('onlineFriendsList');
    if (!container) return;

    const online = friends.filter(f => onlineFriends.get(f.id));
    if (online.length === 0) {
        container.innerHTML = '<p>No friends online</p>';
        return;
    }

    container.innerHTML = online.map(friend => `
        <div class="online-friend-item" onclick="viewProfile('${friend.username}')">
            <img src="${friend.avatar || `https://ui-avatars.com/api/?name=${friend.username}&background=2563eb&color=fff`}" class="online-avatar">
            <div class="online-info">
                <div class="online-name">${escapeHtml(friend.username)}</div>
                <div class="online-status">● Online</div>
            </div>
        </div>
    `).join('');
}

async function loadFriendsCompact() {
    try {
        const friends = await getFriendsList();
        const container = document.getElementById('friendsListCompact');
        if (!container) return;

        if (friends.length === 0) {
            container.innerHTML = '<div class="empty-friends"><i class="fas fa-user-plus"></i><p>No friends yet</p></div>';
            return;
        }

        container.innerHTML = friends.slice(0, 5).map(friend => `
            <div class="friend-item-compact" onclick="viewProfile('${friend.username}')">
                <img src="${friend.avatar || `https://ui-avatars.com/api/?name=${friend.username}&background=2563eb&color=fff`}" class="friend-avatar-compact">
                <div class="friend-info-compact">
                    <div class="friend-name-compact">${escapeHtml(friend.username)}</div>
                    <div class="friend-status-compact">${onlineFriends.get(friend.id) ? '● Online' : '○ Offline'}</div>
                </div>
                <button class="message-btn-compact" onclick="event.stopPropagation(); startChat('${friend.id}')">
                    <i class="fas fa-comment"></i>
                </button>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error:', error);
    }
}

async function loadFriendRequestsCompact() {
    try {
        const response = await fetch('/api/friend-requests');
        const requests = await response.json();
        const card = document.getElementById('friendRequestsCard');
        const container = document.getElementById('friendRequestsCompact');

        if (!card || !container) return;

        if (requests.length === 0) {
            card.style.display = 'none';
            return;
        }

        card.style.display = 'block';
        container.innerHTML = requests.slice(0, 3).map(req => `
            <div class="friend-request-item">
                <img src="${req.avatar || `https://ui-avatars.com/api/?name=${req.username}&background=2563eb&color=fff`}" class="request-avatar">
                <div class="request-info">
                    <div class="request-name">${escapeHtml(req.username)}</div>
                </div>
                <div class="request-actions">
                    <button class="accept-btn" onclick="acceptFriendRequest('${req.id}')">Accept</button>
                    <button class="decline-btn" onclick="declineFriendRequest('${req.id}')">Decline</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error:', error);
    }
}

async function loadFriendRequestsCount() {
    try {
        const response = await fetch('/api/friend-requests');
        const requests = await response.json();
        const badge = document.getElementById('friendRequestBadge');
        if (badge) {
            if (requests.length > 0) {
                badge.textContent = requests.length;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// ============ MESSAGING ============
async function openMessages() {
    openModal('messagesModal');
    await loadConversations();
}

async function loadConversations() {
    try {
        const response = await fetch('/api/messages/conversations');
        const conversations = await response.json();
        const container = document.getElementById('conversationsList');
        if (!container) return;

        if (conversations.length === 0) {
            container.innerHTML = '<div class="no-conversations">No conversations yet</div>';
            return;
        }

        container.innerHTML = conversations.map(conv => `
            <div class="conversation-item" onclick="openConversation('${conv.userId}')">
                <img src="${conv.avatar || `https://ui-avatars.com/api/?name=${conv.username}&background=2563eb&color=fff`}" class="conversation-avatar">
                <div class="conversation-info">
                    <div class="conversation-name">${escapeHtml(conv.username)}</div>
                    <div class="conversation-last">${escapeHtml(conv.lastMessage?.content?.substring(0, 40) || 'No messages')}</div>
                </div>
                ${conv.unread ? `<div class="unread-badge">${conv.unread}</div>` : ''}
            </div>
        `).join('');
    } catch (error) {
        console.error('Error:', error);
    }
}

async function openConversation(userId) {
    currentChatUser = userId;
    try {
        const response = await fetch(`/api/messages/${userId}`);
        const messages = await response.json();
        const userResponse = await fetch(`/api/users/id/${userId}`);
        const userData = await userResponse.json();

        const chatArea = document.getElementById('chatArea');
        if (!chatArea) return;

        chatArea.innerHTML = `
            <div class="chat-header">
                <div class="chat-user-info" onclick="viewProfile('${userData.user.username}')">
                    <img src="${userData.user.avatar || `https://ui-avatars.com/api/?name=${userData.user.username}&background=2563eb&color=fff`}" class="chat-avatar">
                    <div>
                        <div class="chat-name">${escapeHtml(userData.user.username)}</div>
                        <div class="chat-status">${onlineFriends.get(userId) ? 'Online' : 'Offline'}</div>
                    </div>
                </div>
            </div>
            <div class="chat-messages" id="chatMessages">
                ${messages.map(msg => `
                    <div class="message ${msg.from === currentUser.id ? 'sent' : 'received'}">
                        <div class="message-bubble">${escapeHtml(msg.content)}</div>
                        <div class="message-time">${msg.timestamp}</div>
                    </div>
                `).join('')}
            </div>
            <div class="chat-input-area">
                <input type="text" id="messageInput" placeholder="Type a message..." onkeypress="if(event.key==='Enter') sendMessage()">
                <button class="btn-primary" onclick="sendMessage()">Send</button>
            </div>
        `;

        const messagesDiv = document.getElementById('chatMessages');
        if (messagesDiv) messagesDiv.scrollTop = messagesDiv.scrollHeight;
    } catch (error) {
        console.error('Error:', error);
    }
}

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const content = input?.value.trim();
    if (!content || !currentChatUser) return;

    try {
        const response = await fetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: currentChatUser, content })
        });
        const data = await response.json();
        if (data.success) {
            input.value = '';
            appendMessage(data.message);
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

function appendMessage(message) {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    // Convert URLs to clickable links
    let messageContent = escapeHtml(message.content);
    messageContent = messageContent.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: #3b82f6; text-decoration: underline;">$1</a>');

    const messageHTML = `
        <div class="message ${message.from === currentUser.id ? 'sent' : 'received'}">
            <div class="message-bubble">${messageContent}</div>
            <div class="message-time">${message.timestamp}</div>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', messageHTML);
    container.scrollTop = container.scrollHeight;
}

function updateMessageBadge() {
    const badge = document.getElementById('messageBadge');
    if (badge) {
        const unread = document.querySelectorAll('.unread-badge').length;
        if (unread > 0) {
            badge.textContent = unread;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }
}

function startChat(userId) {
    closeAllModals();
    openMessages();
    setTimeout(() => openConversation(userId), 200);
}

// ============ GROUP CHATS ============
async function openGroups() {
    openModal('groupsModal');
    await loadGroups();
}

async function loadGroups() {
    try {
        const response = await fetch('/api/groups');
        const groups = await response.json();
        const container = document.getElementById('groupsContent');
        if (!container) return;

        if (groups.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-users"></i>
                    <h3>No groups yet</h3>
                    <button class="btn-primary" onclick="showCreateGroupModal()">Create Group</button>
                </div>
            `;
            return;
        }

        container.innerHTML = groups.map(group => `
            <div class="group-card" onclick="openGroupChat('${group.id}')">
                <div>
                    <div class="group-name">${escapeHtml(group.name)}</div>
                    <div class="group-members">${group.members.length} members</div>
                </div>
                <i class="fas fa-chevron-right"></i>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error:', error);
    }
}

async function openGroupChat(groupId) {
    currentGroup = groupId;
    try {
        const response = await fetch(`/api/groups/${groupId}`);
        const group = await response.json();

        const modal = document.getElementById('groupsModal');
        if (!modal) return;

        modal.innerHTML = `
            <div class="modal-content modal-large">
                <div class="modal-header">
                    <h2><i class="fas fa-users"></i> ${escapeHtml(group.name)}</h2>
                    <span class="close" onclick="closeGroupsModal()">&times;</span>
                </div>
                <div class="chat-area" style="height: 500px;">
                    <div class="chat-messages" id="groupMessages">
                        ${group.messages?.map(msg => `
                            <div class="message ${msg.from === currentUser.id ? 'sent' : 'received'}">
                                <div class="message-bubble">
                                    <strong>${escapeHtml(msg.fromUsername)}</strong><br>
                                    ${escapeHtml(msg.content)}
                                </div>
                                <div class="message-time">${msg.timestamp}</div>
                            </div>
                        `).join('')}
                    </div>
                    <div class="chat-input-area">
                        <input type="text" id="groupMessageInput" placeholder="Type a message..." onkeypress="if(event.key==='Enter') sendGroupMessage()">
                        <button class="btn-primary" onclick="sendGroupMessage()">Send</button>
                    </div>
                </div>
            </div>
        `;

        openModal('groupsModal');
        const messagesDiv = document.getElementById('groupMessages');
        if (messagesDiv) messagesDiv.scrollTop = messagesDiv.scrollHeight;
    } catch (error) {
        console.error('Error:', error);
    }
}

async function sendGroupMessage() {
    const input = document.getElementById('groupMessageInput');
    const content = input?.value.trim();
    if (!content || !currentGroup) return;

    try {
        const response = await fetch(`/api/groups/${currentGroup}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        const data = await response.json();
        if (data.success) {
            input.value = '';
            await openGroupChat(currentGroup);
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function showCreateGroupModal() {
    const friends = await getFriendsList();
    const container = document.getElementById('groupMembersSelect');
    if (!container) return;

    container.innerHTML = `
        <label>Select Members:</label>
        ${friends.map(friend => `
            <div class="member-select">
                <input type="checkbox" value="${friend.id}" id="member_${friend.id}">
                <label for="member_${friend.id}">${escapeHtml(friend.username)}</label>
            </div>
        `).join('')}
    `;
    openModal('createGroupModal');
}

// ============ SHARE POST ============
async function sharePostToFriend(postId) {
    const friends = await getFriendsList();
    if (friends.length === 0) {
        showToast('No friends to share with', 'error');
        return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 400px;">
            <div class="modal-header">
                <h2><i class="fas fa-share"></i> Share Post</h2>
                <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
            </div>
            <div style="padding: 1rem;">
                <p style="margin-bottom: 1rem;">Select a friend to share with:</p>
                <div style="max-height: 300px; overflow-y: auto;">
                    ${friends.map(friend => `
                        <div class="friend-select-item" onclick="sendSharedPost('${postId}', '${friend.id}', '${friend.username}')" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; cursor: pointer; border-bottom: 1px solid var(--border);">
                            <img src="${friend.avatar || `https://ui-avatars.com/api/?name=${friend.username}&background=2563eb&color=fff`}" style="width: 40px; height: 40px; border-radius: 50%;">
                            <div>
                                <div style="font-weight: 600;">${escapeHtml(friend.username)}</div>
                                <small style="color: var(--text-secondary);">Click to share</small>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

// Update sendSharedPost function
async function sendSharedPost(postId, friendId, friendUsername) {
    const modal = document.querySelector('.modal');
    if (modal) modal.remove();

    try {
        const postResponse = await fetch(`/api/posts/${postId}`);
        const post = await postResponse.json();

        // Make the link clickable with HTML anchor tag
        const shareUrl = `${window.location.origin}/post/${postId}`;
        const shareMessage = `📢 Shared a post: "${post.title}"\n\n${post.description ? post.description.substring(0, 100) + '...' : ''}\n\n🔗 Click here to view: ${shareUrl}`;

        const response = await fetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to: friendId,
                content: shareMessage,
                sharedPostId: postId,
                sharedPostTitle: post.title
            })
        });

        const data = await response.json();
        if (data.success) {
            showCustomAlert(`Post shared with ${friendUsername}!`, 'success');
            await fetch(`/api/posts/${postId}/share`, { method: 'POST' });
        }
    } catch (error) {
        console.error('Error sharing post:', error);
        showCustomAlert('Failed to share post', 'error');
    }
}

// Update sendSharedReel function
async function sendSharedReel(reelId, friendId, friendUsername) {
    // Close modal
    const modal = document.querySelector('.custom-modal');
    if (modal) modal.remove();

    showLoading();

    try {
        // Get reel details
        const response = await fetch(`/api/reels/${reelId}`);

        if (!response.ok) {
            throw new Error('Failed to fetch reel details');
        }

        const reel = await response.json();

        // Make the link clickable
        const shareUrl = `${window.location.origin}/reel/${reelId}`;
        const shareMessage = `🎬 Shared a reel: "${reel.title || 'Untitled Reel'}"\n\n🔗 Click here to watch: ${shareUrl}`;

        // Send as message
        const messageResponse = await fetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to: friendId,
                content: shareMessage
            })
        });

        const messageData = await messageResponse.json();

        if (messageData.success) {
            showCustomAlert(`Reel shared with ${friendUsername}!`, 'success');
        } else {
            throw new Error(messageData.error || 'Failed to send message');
        }
    } catch (error) {
        console.error('Error sharing reel:', error);
        showCustomAlert('Failed to share reel: ' + error.message, 'error');
    }

    hideLoading();
}

// ============ POST CREATION ============
function openCreatePostModal() {
    document.getElementById('postTitle').value = '';
    document.getElementById('postDescription').value = '';
    document.getElementById('postVisibility').value = 'public';
    selectedMediaFiles = [];
    document.getElementById('postMediaPreview').style.display = 'none';
    document.getElementById('postMediaInput').value = '';
    updatePreviewGrid();
    openModal('createPostModal');
}

function closeCreatePostModal() {
    closeModal('createPostModal');
}

document.getElementById('postMediaInput')?.addEventListener('change', function (e) {
    const files = Array.from(e.target.files);

    if (selectedMediaFiles.length + files.length > 10) {
        showToast('Maximum 10 files allowed', 'error');
        return;
    }

    const validFiles = [];
    for (const file of files) {
        if (file.size > 500 * 1024 * 1024) {
            showToast(`${file.name} is too large! Maximum 500MB`, 'error');
            continue;
        }
        validFiles.push(file);
    }

    if (validFiles.length === 0) return;

    selectedMediaFiles.push(...validFiles);
    updatePreviewGrid();
    document.getElementById('postMediaPreview').style.display = 'block';
});

function updatePreviewGrid() {
    const grid = document.getElementById('previewGrid');
    const fileCountSpan = document.getElementById('fileCount');
    if (!grid) return;

    fileCountSpan.textContent = selectedMediaFiles.length;

    if (selectedMediaFiles.length === 0) {
        document.getElementById('postMediaPreview').style.display = 'none';
        return;
    }

    grid.innerHTML = selectedMediaFiles.map((file, index) => {
        const url = URL.createObjectURL(file);
        const isVideo = file.type.startsWith('video/');
        return `
            <div class="preview-item" data-index="${index}">
                ${isVideo ?
                `<video src="${url}" class="preview-video"></video>` :
                `<img src="${url}" class="preview-image">`
            }
                <button type="button" class="remove-preview-btn" onclick="removeMediaFile(${index})">
                    <i class="fas fa-times"></i>
                </button>
                <div class="preview-file-name">${file.name.substring(0, 20)}${file.name.length > 20 ? '...' : ''}</div>
            </div>
        `;
    }).join('');
}

function removeMediaFile(index) {
    selectedMediaFiles.splice(index, 1);
    updatePreviewGrid();
    document.getElementById('postMediaInput').value = '';
}

function clearAllMedia() {
    selectedMediaFiles = [];
    updatePreviewGrid();
    document.getElementById('postMediaInput').value = '';
}

document.getElementById('createPostForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const title = document.getElementById('postTitle').value.trim();
    if (!title) {
        showToast('Please enter a title', 'error');
        return;
    }

    const description = document.getElementById('postDescription').value.trim();
    const visibility = document.getElementById('postVisibility').value;

    const formData = new FormData();
    formData.append('title', title);
    formData.append('description', description);
    formData.append('visibility', visibility);

    for (const file of selectedMediaFiles) {
        formData.append('media', file);
    }

    showLoading();

    try {
        const response = await fetch('/api/posts', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            showToast(`Post created with ${selectedMediaFiles.length} file(s)!`, 'success');
            closeCreatePostModal();
            await loadFeed();
        } else {
            showToast(data.error || 'Failed to create post', 'error');
        }
    } catch (error) {
        console.error('Error creating post:', error);
        showToast('Failed to create post. Please try again.', 'error');
    }

    hideLoading();
});

// ============ REELS ============
// ============ REELS - COMPLETE FIX ============
let selectedReelVideo = null;

function openCreateReelModal() {
    document.getElementById('reelTitle').value = '';
    document.getElementById('reelDescription').value = '';
    selectedReelVideo = null;
    document.getElementById('reelPreview').style.display = 'none';
    const reelVideoInput = document.getElementById('reelVideoInput');
    if (reelVideoInput) reelVideoInput.value = '';
    openModal('createReelModal');
}

function closeCreateReelModal() {
    closeModal('createReelModal');
}

// Handle reel video selection
const reelVideoInput = document.getElementById('reelVideoInput');
if (reelVideoInput) {
    reelVideoInput.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (!file) return;

        // Check file size (500MB max)
        if (file.size > 500 * 1024 * 1024) {
            showToast('Video too large! Maximum 500MB', 'error');
            this.value = '';
            return;
        }

        // Check if it's a video
        if (!file.type.startsWith('video/')) {
            showToast('Please select a video file (MP4, MOV, AVI)', 'error');
            this.value = '';
            return;
        }

        selectedReelVideo = file;
        const previewDiv = document.getElementById('reelPreview');
        const video = previewDiv.querySelector('video');
        const url = URL.createObjectURL(file);
        video.src = url;
        previewDiv.style.display = 'block';
    });
}

function removeReelMedia() {
    selectedReelVideo = null;
    const reelVideoInput = document.getElementById('reelVideoInput');
    if (reelVideoInput) reelVideoInput.value = '';
    const previewDiv = document.getElementById('reelPreview');
    previewDiv.style.display = 'none';
    const video = previewDiv.querySelector('video');
    if (video) video.src = '';
}

// Handle reel submission
const createReelForm = document.getElementById('createReelForm');
if (createReelForm) {
    createReelForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!selectedReelVideo) {
            showToast('Please select a video', 'error');
            return;
        }

        const title = document.getElementById('reelTitle').value.trim();
        const description = document.getElementById('reelDescription').value.trim();

        const formData = new FormData();
        formData.append('title', title || 'Untitled Reel');
        formData.append('description', description);
        formData.append('video', selectedReelVideo);

        showLoading();

        try {
            const response = await fetch('/api/reels', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (data.success) {
                showToast('Reel posted successfully!', 'success');
                closeCreateReelModal();
                // Refresh reels if we're on reels page
                if (currentView === 'reels') {
                    await loadReels();
                }
            } else {
                showToast(data.error || 'Failed to create reel', 'error');
            }
        } catch (error) {
            console.error('Error creating reel:', error);
            showToast('Failed to create reel. Please try again.', 'error');
        }

        hideLoading();
    });
}

// ============ INSTAGRAM-STYLE REELS ============
let currentReelIndex = 0;
let reelsData = [];
let reelSoundEnabled = true;

// ============ SIMPLE REELS LIKE INSTAGRAM ============
// ============ REELS WITH COMMENTS ============
let currentReelPlaying = null;

// ============ COMPLETE REELS FUNCTIONALITY ============
// let reelsData = [];
// let currentReelIndex = 0;
// let isLoadingReels = false;
// let hasMoreReels = true;
// let reelCursor = null;
// let currentPlayingVideo = null;
// let reelObservers = [];

// Load reels with pagination
async function loadReels(loadMore = false) {
    if (isLoadingReels) return;

    if (!loadMore) {
        currentReelIndex = 0;
        hasMoreReels = true;
        reelCursor = null;
        reelsData = [];
        showLoading();
    }

    isLoadingReels = true;

    try {
        const url = `/api/reels/feed?limit=5${reelCursor ? `&cursor=${reelCursor}` : ''}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.reels && data.reels.length > 0) {
            if (loadMore) {
                reelsData = [...reelsData, ...data.reels];
                appendReels(data.reels);
            } else {
                reelsData = data.reels;
                renderReels(data.reels);
            }
            reelCursor = data.nextCursor;
            hasMoreReels = data.hasMore;
        } else {
            hasMoreReels = false;
            if (!loadMore) {
                showEmptyReels();
            }
        }
    } catch (error) {
        console.error('Error loading reels:', error);
        showToast('Failed to load reels', 'error');
    }

    isLoadingReels = false;
    if (!loadMore) hideLoading();
}

function renderReels(reels) {
    const container = document.getElementById('feedContainer');
    if (!container) return;

    container.innerHTML = `
        <div class="reels-container" id="reelsContainer">
            ${reels.map((reel, index) => createReelHTML(reel, index)).join('')}
            <div id="reelsLoader" class="reels-loading" style="display: none;">Loading more...</div>
        </div>
    `;

    setupReelObservers();
    setupScrollListener();
}

function appendReels(reels) {
    const container = document.getElementById('reelsContainer');
    if (!container) return;

    // Remove loader if present
    const loader = document.getElementById('reelsLoader');
    if (loader) loader.remove();

    reels.forEach((reel, index) => {
        container.insertAdjacentHTML('beforeend', createReelHTML(reel, reelsData.length - reels.length + index));
    });

    container.insertAdjacentHTML('beforeend', '<div id="reelsLoader" class="reels-loading" style="display: none;">Loading more...</div>');
    setupReelObservers();
}

function createReelHTML(reel, index) {
    console.log('Creating reel HTML with video URL:', reel.video_url);

    const videoUrl = reel.video_url || reel.video || `/uploads/reels/${reel.filename}`;
    const shareUrl = `${window.location.origin}/reel/${reel.id}`;
    const videoId = `reel-video-${reel.id}`;

    return `
        <div class="reel-item" data-reel-id="${reel.id}" data-reel-index="${index}">
            <video 
                id="${videoId}"
                class="reel-video" 
                src="${videoUrl}"
                preload="auto"
                playsinline
                muted
                style="width: 100%; height: 100%; object-fit: contain;"
            ></video>
            
            <div class="reel-progress" onclick="seekReel(event, '${reel.id}')">
                <div class="reel-progress-bar" id="progress-${reel.id}"></div>
            </div>
            
            <div class="reel-sidebar">
                <button class="reel-action ${reel.isLiked ? 'liked' : ''}" onclick="likeReel('${reel.id}')">
                    <i class="fas fa-heart"></i>
                    <span id="like-count-${reel.id}">${reel.likes_count || 0}</span>
                </button>
                <button class="reel-action" onclick="openReelComments('${reel.id}')">
                    <i class="fas fa-comment"></i>
                    <span id="comment-count-${reel.id}">${reel.comments_count || 0}</span>
                </button>
                <button class="reel-action" onclick="shareReelToFriend('${reel.id}')">
                    <i class="fas fa-share-alt"></i>
                    <span>Share</span>
                </button>
            </div>
            
            <div class="reel-overlay">
                <div class="reel-author">
                    <img src="${reel.author_avatar || `https://ui-avatars.com/api/?name=${reel.author}&background=2563eb&color=fff`}" class="reel-author-avatar" onclick="viewProfile('${reel.author}')">
                    <span class="reel-author-name" onclick="viewProfile('${reel.author}')">${escapeHtml(reel.author)}</span>
                    ${!reel.isFollowing ? `<button class="reel-follow-btn" onclick="followReelAuthor('${reel.user_id}', event)">Follow</button>` : ''}
                </div>
                <div class="reel-caption">
                    ${linkify(reel.caption || '')}
                </div>
                <div class="reel-audio" onclick="showAudioReels('${reel.audio_name || 'original'}')">
                    <i class="fas fa-music"></i>
                    <span>${escapeHtml(reel.audio_name || 'Original Audio')}</span>
                </div>
            </div>
        </div>
    `;
}

// Share reel to friend
// ============ SHARE REEL ============
async function shareReelToFriend(reelId) {
    console.log('Sharing reel:', reelId);

    const friends = await getFriendsList();
    if (friends.length === 0) {
        showCustomAlert('No friends to share with', 'error');
        return;
    }

    // Create friend selection modal
    const modal = document.createElement('div');
    modal.className = 'custom-modal';
    modal.innerHTML = `
        <div class="custom-modal-content">
            <div class="custom-modal-header">
                <h3><i class="fas fa-share-alt"></i> Share Reel</h3>
                <button class="custom-modal-close" onclick="this.closest('.custom-modal').remove()">&times;</button>
            </div>
            <div class="custom-modal-body">
                <p>Select a friend to share this reel with:</p>
                <div class="friends-list-container" style="max-height: 300px; overflow-y: auto;">
                    ${friends.map(friend => `
                        <div class="friend-share-item" onclick="sendSharedReel('${reelId}', '${friend.id}', '${friend.username}')">
                            <img src="${friend.avatar || `https://ui-avatars.com/api/?name=${friend.username}&background=2563eb&color=fff`}" class="friend-share-avatar">
                            <div class="friend-share-info">
                                <div class="friend-share-name">${escapeHtml(friend.username)}</div>
                                <div class="friend-share-status">Click to share</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

async function sendSharedReel(reelId, friendId, friendUsername) {
    console.log('Sending shared reel:', reelId, 'to:', friendId);

    // Close modal
    const modal = document.querySelector('.custom-modal');
    if (modal) modal.remove();

    showLoading();

    try {
        // Get reel details
        const response = await fetch(`/api/reels/${reelId}`);

        if (!response.ok) {
            throw new Error('Failed to fetch reel details');
        }

        const reel = await response.json();
        console.log('Reel details:', reel);

        const shareUrl = `${window.location.origin}/reel/${reelId}`;
        const shareMessage = `🎬 Shared a reel: "${reel.title || 'Untitled Reel'}"\n\n${shareUrl}`;

        // Send as message
        const messageResponse = await fetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to: friendId,
                content: shareMessage
            })
        });

        const messageData = await messageResponse.json();

        if (messageData.success) {
            showCustomAlert(`Reel shared with ${friendUsername}!`, 'success');
        } else {
            throw new Error(messageData.error || 'Failed to send message');
        }
    } catch (error) {
        console.error('Error sharing reel:', error);
        showCustomAlert('Failed to share reel: ' + error.message, 'error');
    }

    hideLoading();
}

// Setup Intersection Observer for autoplay
function setupReelObservers() {
    // Disconnect old observers
    if (reelObservers && reelObservers.length) {
        reelObservers.forEach(observer => observer.disconnect());
    }
    reelObservers = [];

    const reels = document.querySelectorAll('.reel-item');
    console.log('Setting up observers for', reels.length, 'reels');

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const video = entry.target.querySelector('video');
            if (!video) {
                console.log('No video found in reel');
                return;
            }

            if (entry.isIntersecting && entry.intersectionRatio >= 0.3) {
                // Pause all other videos first
                document.querySelectorAll('.reel-video').forEach(v => {
                    if (v !== video && !v.paused) {
                        v.pause();
                    }
                });

                // Play this video
                const playPromise = video.play();
                if (playPromise !== undefined) {
                    playPromise.then(() => {
                        console.log('Video playing');
                        video.muted = false; // Unmute after play starts
                    }).catch(error => {
                        console.log('Play error:', error);
                        // Try playing muted first
                        video.muted = true;
                        video.play().catch(e => console.log('Muted play error:', e));
                    });
                }

                // Track view
                const reelId = entry.target.dataset.reelId;
                trackReelView(reelId);
                currentReelIndex = parseInt(entry.target.dataset.reelIndex);

                // Preload next video
                preloadNextVideo(currentReelIndex + 1);
            } else {
                video.pause();
            }
        });
    }, { threshold: 0.3 });

    reels.forEach(reel => {
        observer.observe(reel);
        reelObservers.push(observer);
    });
}

// Preload next video
function preloadNextVideo(index) {
    const nextReel = document.querySelector(`.reel-item[data-reel-index="${index}"]`);
    if (nextReel) {
        const video = nextReel.querySelector('video');
        if (video) {
            video.preload = 'auto';
            video.load();
        }
    }
}

// Setup scroll listener for infinite scroll
function setupScrollListener() {
    const container = document.getElementById('reelsContainer');
    if (!container) return;

    const handleScroll = () => {
        if (isLoadingReels || !hasMoreReels) return;

        const scrollTop = container.scrollTop;
        const scrollHeight = container.scrollHeight;
        const clientHeight = container.clientHeight;

        if (scrollTop + clientHeight >= scrollHeight - 200) {
            const loader = document.getElementById('reelsLoader');
            if (loader) loader.style.display = 'block';
            loadReels(true);
        }
    };

    container.removeEventListener('scroll', handleScroll);
    container.addEventListener('scroll', handleScroll);
}

// Seek video
function seekReel(event, reelId) {
    event.stopPropagation();
    const progressBar = document.getElementById(`progress-${reelId}`);
    const reelItem = document.querySelector(`.reel-item[data-reel-id="${reelId}"]`);
    const video = reelItem?.querySelector('video');

    if (video && progressBar) {
        const rect = progressBar.parentElement.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const width = rect.width;
        const percentage = x / width;
        video.currentTime = percentage * video.duration;
    }
}

// Update progress bar
function updateReelProgress(video, reelId) {
    const progressBar = document.getElementById(`progress-${reelId}`);
    if (progressBar && video.duration) {
        const percentage = (video.currentTime / video.duration) * 100;
        progressBar.style.width = `${percentage}%`;
    }
}

// Like reel
async function likeReel(reelId) {
    try {
        const response = await fetch(`/api/reels/${reelId}/like`, { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            const likeBtn = document.querySelector(`.reel-item[data-reel-id="${reelId}"] .reel-action:first-child`);
            const likeSpan = document.getElementById(`like-count-${reelId}`);

            if (likeBtn) {
                if (data.isLiked) {
                    likeBtn.classList.add('liked');
                    // Show heart animation
                    showHeartAnimation(reelId);
                } else {
                    likeBtn.classList.remove('liked');
                }
            }
            if (likeSpan) likeSpan.textContent = data.likes;
        }
    } catch (error) {
        console.error('Error liking reel:', error);
    }
}

// Show heart animation on double tap
function showHeartAnimation(reelId) {
    const reelItem = document.querySelector(`.reel-item[data-reel-id="${reelId}"]`);
    if (!reelItem) return;

    const heart = document.createElement('div');
    heart.className = 'heart-animation';
    heart.innerHTML = '<i class="fas fa-heart"></i>';
    reelItem.appendChild(heart);

    setTimeout(() => heart.remove(), 600);
}

// Track view
async function trackReelView(reelId) {
    try {
        await fetch(`/api/reels/${reelId}/view`, { method: 'POST' });
    } catch (error) {
        console.error('Error tracking view:', error);
    }
}

// Open comments modal
function openReelComments(reelId) {
    const reel = reelsData.find(r => r.id === reelId);
    if (!reel) return;

    const modal = document.createElement('div');
    modal.className = 'reel-comments-modal';
    modal.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <h3>Comments (${reel.comments_count || 0})</h3>
            <button class="close-btn" onclick="this.closest('.reel-comments-modal').remove()">&times;</button>
        </div>
        <div id="reel-comments-list" style="max-height: 50vh; overflow-y: auto;">
            ${reel.comments?.map(comment => `
                <div class="reel-comment" style="display: flex; gap: 0.5rem; margin-bottom: 0.75rem;">
                    <img src="${comment.avatar || `https://ui-avatars.com/api/?name=${comment.username}&background=64748b&color=fff`}" style="width: 32px; height: 32px; border-radius: 50%;">
                    <div style="flex: 1;">
                        <div style="font-weight: 600; font-size: 0.8rem;">${escapeHtml(comment.username)}</div>
                        <div style="font-size: 0.8rem;">${escapeHtml(comment.comment)}</div>
                    </div>
                </div>
            `).join('') || '<div style="text-align: center; padding: 2rem;">No comments yet</div>'}
        </div>
        <div class="reel-add-comment" style="display: flex; gap: 0.5rem; margin-top: 1rem;">
            <input type="text" id="reel-comment-input" placeholder="Add a comment..." style="flex: 1; padding: 0.5rem; border-radius: 20px; border: 1px solid var(--border); background: var(--bg-primary);">
            <button class="btn-primary" onclick="addReelComment('${reelId}')">Post</button>
        </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('show'), 10);
}

// Add comment to reel
async function addReelComment(reelId) {
    const input = document.querySelector('#reel-comment-input');
    const comment = input?.value.trim();

    if (!comment) {
        showToast('Please enter a comment', 'error');
        return;
    }

    try {
        const response = await fetch(`/api/reels/${reelId}/comment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ comment })
        });

        const data = await response.json();
        if (data.success) {
            input.value = '';
            // Close modal and refresh
            document.querySelector('.reel-comments-modal')?.remove();
            // Update comment count
            const commentSpan = document.getElementById(`comment-count-${reelId}`);
            if (commentSpan) {
                commentSpan.textContent = parseInt(commentSpan.textContent) + 1;
            }
            showToast('Comment added!', 'success');
        }
    } catch (error) {
        console.error('Error adding comment:', error);
        showToast('Failed to add comment', 'error');
    }
}

// Share reel
function shareReel(reelId) {
    const shareUrl = `${window.location.origin}/reel/${reelId}`;
    navigator.clipboard.writeText(shareUrl);
    showToast('Reel link copied to clipboard!', 'success');
}

// Follow author
async function followReelAuthor(userId, event) {
    event.stopPropagation();
    try {
        const response = await fetch(`/api/friends/request/${userId}`, { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            showToast('Followed!', 'success');
            const btn = event.target;
            btn.textContent = 'Following';
            btn.disabled = true;
        }
    } catch (error) {
        console.error('Error following:', error);
    }
}

// Show empty reels state
function showEmptyReels() {
    const container = document.getElementById('feedContainer');
    if (container) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-film"></i>
                <h3>No reels yet</h3>
                <p>Be the first to create a reel!</p>
                <button class="btn-primary" onclick="openCreateReelModal()">Create Reel</button>
            </div>
        `;
    }
}

// Show audio reels (placeholder)
function showAudioReels(audioName) {
    showToast(`Showing reels with "${audioName}" (coming soon)`, 'info');
}

// Video progress update interval
let progressInterval = null;

function startProgressTracking() {
    if (progressInterval) clearInterval(progressInterval);

    progressInterval = setInterval(() => {
        const visibleReel = document.querySelector('.reel-item:has(video:playing)');
        if (visibleReel) {
            const video = visibleReel.querySelector('video');
            const reelId = visibleReel.dataset.reelId;
            if (video && !video.paused) {
                updateReelProgress(video, reelId);
            }
        }
    }, 100);
}

// Double tap for like
function setupDoubleTapLike() {
    document.addEventListener('dblclick', (e) => {
        const reelItem = e.target.closest('.reel-item');
        if (reelItem) {
            const reelId = reelItem.dataset.reelId;
            likeReel(reelId);
            showHeartAnimation(reelId);
        }
    });
}

// Initialize reels page
async function initReelsPage() {
    await loadReels();
    startProgressTracking();
    setupDoubleTapLike();
}

// Override loadReels function for the reels page
const originalLoadReels = loadReels;
window.loadReels = initReelsPage;

// ============ PROFILE EDITING ============
function openSettings() {
    openModal('editProfileModal');
    document.getElementById('editUsername').value = currentUser.username;
    document.getElementById('editBio').value = currentUser.bio || '';
}

function closeEditProfileModal() {
    closeModal('editProfileModal');
}

document.getElementById('editProfileForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('editUsername').value;
    const bio = document.getElementById('editBio').value;

    try {
        const response = await fetch('/api/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, bio })
        });
        const data = await response.json();
        if (data.success) {
            showToast('Profile updated!', 'success');
            closeEditProfileModal();
            location.reload();
        }
    } catch (error) {
        console.error('Error:', error);
    }
});

// Update the avatar upload event listener
// Handle avatar upload with GIF support
document.getElementById('avatarInput')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check file size (max 5MB for avatar)
    if (file.size > 5 * 1024 * 1024) {
        showCustomAlert('Avatar too large! Maximum 5MB', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('avatar', file);

    showLoading();
    
    try {
        const response = await fetch('/api/upload-avatar', { 
            method: 'POST', 
            body: formData 
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Update current user avatar
            currentUser.avatar = data.avatar;
            
            // Add timestamp to bypass cache
            const avatarUrl = `${data.avatar}?t=${Date.now()}`;
            
            // Update navbar avatar
            const navAvatar = document.getElementById('navAvatar');
            if (navAvatar) navAvatar.src = avatarUrl;
            
            // Update mobile menu avatar
            const mobileMenuAvatar = document.getElementById('mobileMenuAvatar');
            if (mobileMenuAvatar) mobileMenuAvatar.src = avatarUrl;
            
            // Update edit modal preview
            const editAvatarPreview = document.getElementById('editAvatarPreview');
            if (editAvatarPreview) editAvatarPreview.src = avatarUrl;
            
            // Refresh current feed to update all avatars
            if (currentView === 'feed') {
                await loadFeed();
            } else if (currentView === 'reels') {
                await loadReelsFeed();
            }
            
            showCustomAlert('Profile picture updated! (GIFs supported)', 'success');
        }
    } catch (error) {
        console.error('Error uploading avatar:', error);
        showCustomAlert('Failed to update avatar', 'error');
    }
    
    hideLoading();
});

// ============ ADMIN PANEL ============
function openAdminPanel() {
    if (currentUser?.role !== 'admin') {
        showToast('Admin access required', 'error');
        return;
    }
    openModal('adminPanelModal');
    loadAdminUsers();
}

function closeAdminPanel() {
    closeModal('adminPanelModal');
}

let currentAdminTab = 'users';

async function showAdminTab(tab) {
    currentAdminTab = tab;
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(btn => btn.textContent.toLowerCase().includes(tab));
    if (activeBtn) activeBtn.classList.add('active');

    if (tab === 'users') {
        await loadAdminUsers();
    } else if (tab === 'posts') {
        await loadAdminPosts();
    } else if (tab === 'suspended') {
        await loadAdminSuspended();
    } else if (tab === 'warnings') {
        await loadAdminWarnings();
    }
}

async function loadAdminUsers() {
    const container = document.getElementById('adminContent');
    if (!container) return;

    try {
        const response = await fetch('/api/admin/users');
        const users = await response.json();

        container.innerHTML = `
            <div class="admin-search-bar">
                <input type="text" id="adminUserSearch" placeholder="🔍 Search users by name or email..." class="admin-search-input">
            </div>
            <div class="admin-stats-bar">
                <div class="stat-box">👥 Total: ${users.length}</div>
                <div class="stat-box">👑 Admins: ${users.filter(u => u.role === 'admin').length}</div>
                <div class="stat-box">🚫 Banned: ${users.filter(u => u.isBanned).length}</div>
                <div class="stat-box">⏰ Suspended: ${users.filter(u => u.isSuspended).length}</div>
            </div>
            <div class="admin-users-grid">
                ${users.map(user => `
                    <div class="admin-user-card">
                        <div class="admin-user-header">
                            <img src="${user.avatar || `https://ui-avatars.com/api/?name=${user.username}&background=2563eb&color=fff`}" class="admin-user-avatar">
                            <div>
                                <div class="admin-user-name">${escapeHtml(user.username)}</div>
                                <div class="admin-user-email">${escapeHtml(user.email)}</div>
                                <span class="admin-user-role-badge ${user.role}">${user.role === 'admin' ? '👑 Admin' : '👤 User'}</span>
                                ${user.isBanned ? '<span class="admin-user-status banned">🚫 Banned</span>' : ''}
                                ${user.isSuspended ? '<span class="admin-user-status suspended">⏰ Suspended</span>' : ''}
                            </div>
                        </div>
                        <div class="admin-user-actions">
                            <button class="admin-action-btn view" onclick="viewUserActivity('${user.id}')">
                                <i class="fas fa-chart-line"></i> Activity
                            </button>
                            ${user.role !== 'admin' ? `
                                <button class="admin-action-btn make-admin" onclick="makeAdmin('${user.id}')">
                                    <i class="fas fa-crown"></i> Make Admin
                                </button>
                            ` : user.email !== 'shresthaavaya112@gmail.com' ? `
                                <button class="admin-action-btn remove-admin" onclick="removeAdmin('${user.id}')">
                                    <i class="fas fa-user-minus"></i> Remove Admin
                                </button>
                            ` : ''}
                            ${!user.isSuspended ? `
                                <button class="admin-action-btn suspend" onclick="suspendUser('${user.id}')">
                                    <i class="fas fa-clock"></i> Suspend
                                </button>
                            ` : `
                                <button class="admin-action-btn unsuspend" onclick="unsuspendUser('${user.id}')">
                                    <i class="fas fa-check-circle"></i> Unsuspend
                                </button>
                            `}
                            <button class="admin-action-btn warn" onclick="warnUser('${user.id}')">
                                <i class="fas fa-exclamation-triangle"></i> Warn
                            </button>
                            <button class="admin-action-btn ban" onclick="banUser('${user.id}')">
                                <i class="fas fa-ban"></i> Ban
                            </button>
                            <button class="admin-action-btn delete" onclick="deleteUserPermanent('${user.id}')">
                                <i class="fas fa-trash-alt"></i> Delete
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        const searchInput = document.getElementById('adminUserSearch');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const term = e.target.value.toLowerCase();
                document.querySelectorAll('.admin-user-card').forEach(card => {
                    const text = card.textContent.toLowerCase();
                    card.style.display = text.includes(term) ? 'block' : 'none';
                });
            });
        }
    } catch (error) {
        console.error('Error loading users:', error);
        container.innerHTML = '<div class="admin-empty">❌ Error loading users</div>';
    }
}

async function loadAdminPosts() {
    const container = document.getElementById('adminContent');
    if (!container) return;

    try {
        const response = await fetch('/api/admin/all-posts');
        const data = await response.json();

        if (!data.posts || data.posts.length === 0) {
            container.innerHTML = '<div class="admin-empty">📭 No posts found</div>';
            return;
        }

        container.innerHTML = `
            <div class="admin-stats-bar">
                <div class="stat-box">📊 Total Posts: ${data.total}</div>
                <div class="stat-box">📄 Page 1 of ${data.totalPages}</div>
            </div>
            <div class="admin-posts-container">
                ${data.posts.map(post => `
                    <div class="admin-post-card">
                        <div class="admin-post-header">
                            <div>
                                <strong>${escapeHtml(post.title)}</strong>
                                <div><small>By: ${escapeHtml(post.author)} | ${post.createdAt}</small></div>
                                <div><small>❤️ ${post.likes} | 💬 ${post.comments?.length || 0} | 🔄 ${post.shares || 0}</small></div>
                            </div>
                        </div>
                        <div class="admin-post-actions">
                            <button class="admin-action-btn edit" onclick="adminEditPost('${post.id}')">
                                <i class="fas fa-edit"></i> Edit
                            </button>
                            <button class="admin-action-btn delete" onclick="adminDeletePost('${post.id}')">
                                <i class="fas fa-trash-alt"></i> Delete
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    } catch (error) {
        console.error('Error loading posts:', error);
        container.innerHTML = '<div class="admin-empty">❌ Error loading posts</div>';
    }
}

async function loadAdminSuspended() {
    const container = document.getElementById('adminContent');
    if (!container) return;

    try {
        const response = await fetch('/api/admin/suspended-users');
        const suspended = await response.json();

        if (suspended.length === 0) {
            container.innerHTML = '<div class="admin-empty">No suspended users</div>';
            return;
        }

        container.innerHTML = `
            <div class="admin-suspended-grid">
                ${suspended.map(user => `
                    <div class="admin-suspended-card">
                        <div>
                            <strong>${escapeHtml(user.username)}</strong>
                            <div><small>${user.email}</small></div>
                            <div><small>⏰ Suspended until: ${new Date(user.suspendedUntil).toLocaleString()}</small></div>
                            <div><small>📝 Reason: ${user.suspendReason}</small></div>
                        </div>
                        <button class="admin-action-btn unsuspend" onclick="unsuspendUser('${user.id}')">
                            <i class="fas fa-check-circle"></i> Unsuspend
                        </button>
                    </div>
                `).join('')}
            </div>
        `;
    } catch (error) {
        console.error('Error loading suspended users:', error);
        container.innerHTML = '<div class="admin-empty">❌ Error loading suspended users</div>';
    }
}

async function loadAdminWarnings() {
    const container = document.getElementById('adminContent');
    if (!container) return;

    try {
        const response = await fetch('/api/admin/warnings');
        const warnings = await response.json();

        if (warnings.length === 0) {
            container.innerHTML = '<div class="admin-empty">No warnings issued</div>';
            return;
        }

        container.innerHTML = `
            <div class="admin-warnings-grid">
                ${warnings.map(w => `
                    <div class="admin-warning-card">
                        <div><strong>⚠️ ${escapeHtml(w.username)}</strong></div>
                        ${w.warnings.map(warn => `
                            <div class="warning-item">
                                <div>📢 ${escapeHtml(warn.message)}</div>
                                <div><small>📅 Issued: ${warn.issuedAt}</small></div>
                            </div>
                        `).join('')}
                    </div>
                `).join('')}
            </div>
        `;
    } catch (error) {
        console.error('Error loading warnings:', error);
        container.innerHTML = '<div class="admin-empty">❌ Error loading warnings</div>';
    }
}

async function makeAdmin(userId) {
    if (!confirm('Make this user an admin?')) return;
    try {
        const response = await fetch(`/api/admin/make-admin/${userId}`, { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            showToast(data.message, 'success');
            await loadAdminUsers();
        }
    } catch (error) {
        console.error('Error:', error);
        showToast('Failed to make admin', 'error');
    }
}

async function removeAdmin(userId) {
    if (!confirm('Remove admin privileges from this user?')) return;
    try {
        const response = await fetch(`/api/admin/remove-admin/${userId}`, { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            showToast(data.message, 'success');
            await loadAdminUsers();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function suspendUser(userId) {
    const hours = prompt('Enter suspension duration (in hours):', '24');
    if (!hours) return;
    const reason = prompt('Reason for suspension:', 'Violation of community guidelines');
    if (!reason) return;
    try {
        const response = await fetch(`/api/admin/suspend/${userId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ duration: parseInt(hours), reason: reason })
        });
        const data = await response.json();
        if (data.success) {
            showToast(data.message, 'success');
            await loadAdminUsers();
            await loadAdminSuspended();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function unsuspendUser(userId) {
    if (!confirm('Unsuspend this user?')) return;
    try {
        const response = await fetch(`/api/admin/unsuspend/${userId}`, { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            showToast(data.message, 'success');
            await loadAdminUsers();
            await loadAdminSuspended();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function banUser(userId) {
    const reason = prompt('Reason for ban:', 'Violation of terms of service');
    if (!reason) return;
    if (!confirm('Ban this user? They will not be able to login again.')) return;
    try {
        const response = await fetch(`/api/admin/ban/${userId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: reason })
        });
        const data = await response.json();
        if (data.success) {
            showToast(data.message, 'success');
            await loadAdminUsers();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function warnUser(userId) {
    const warning = prompt('Enter warning message:', 'Please follow community guidelines');
    if (!warning) return;
    try {
        const response = await fetch(`/api/admin/warn/${userId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ warning: warning })
        });
        const data = await response.json();
        if (data.success) {
            showToast(data.message, 'success');
            await loadAdminUsers();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function deleteUserPermanent(userId) {
    const reason = prompt('Reason for deleting this account:', 'Violation of terms of service');
    if (!reason) return;
    if (!confirm('WARNING: This will permanently delete the user\'s account, all their posts, comments, and data. This cannot be undone. Continue?')) return;
    try {
        const response = await fetch(`/api/admin/users/${userId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: reason })
        });
        const data = await response.json();
        if (data.success) {
            showToast(data.message, 'success');
            await loadAdminUsers();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function adminEditPost(postId) {
    const newTitle = prompt('Enter new title:');
    if (!newTitle) return;
    const newDescription = prompt('Enter new description:', '');
    try {
        const response = await fetch(`/api/admin/posts/${postId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: newTitle, description: newDescription })
        });
        const data = await response.json();
        if (data.success) {
            showToast('Post updated!', 'success');
            await loadAdminPosts();
            await loadFeed();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function adminDeletePost(postId) {
    if (!confirm('Delete this post permanently?')) return;
    try {
        const response = await fetch(`/api/admin/posts/${postId}`, { method: 'DELETE' });
        const data = await response.json();
        if (data.success) {
            showToast('Post deleted!', 'success');
            await loadAdminPosts();
            await loadFeed();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function viewUserActivity(userId) {
    try {
        const response = await fetch(`/api/admin/user-activity/${userId}`);
        const data = await response.json();
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal-content modal-large">
                <div class="modal-header">
                    <h2><i class="fas fa-chart-line"></i> User Activity</h2>
                    <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
                </div>
                <div style="padding: 1rem;">
                    <div class="activity-stats">
                        <div class="stat-card">📝 Total Posts: ${data.totalPosts}</div>
                        <div class="stat-card">💬 Total Comments: ${data.totalComments}</div>
                    </div>
                    <h3>Recent Posts</h3>
                    ${data.posts.slice(0, 10).map(post => `
                        <div class="activity-item">
                            <strong>${escapeHtml(post.title)}</strong>
                            <div><small>${post.createdAt}</small></div>
                            <div>${escapeHtml(post.description?.substring(0, 100))}</div>
                        </div>
                    `).join('') || '<div>No posts</div>'}
                    <h3>Recent Comments</h3>
                    ${data.comments.slice(0, 10).map(comment => `
                        <div class="activity-item">
                            <strong>On: ${escapeHtml(comment.postTitle)}</strong>
                            <div><small>${comment.createdAt}</small></div>
                            <div>${escapeHtml(comment.comment)}</div>
                        </div>
                    `).join('') || '<div>No comments</div>'}
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    } catch (error) {
        console.error('Error:', error);
        showToast('Failed to load user activity', 'error');
    }
}

// ============ MODAL MANAGEMENT ============
function openModal(modalId) {
    if (activeModal && activeModal !== modalId) {
        closeModal(activeModal);
    }
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'flex';
        activeModal = modalId;
        document.addEventListener('keydown', handleEscapeKey);
        modal.addEventListener('click', function (e) {
            if (e.target === modal) {
                closeModal(modalId);
            }
        });
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
        if (activeModal === modalId) {
            activeModal = null;
        }
    }
}

function handleEscapeKey(e) {
    if (e.key === 'Escape' && activeModal) {
        closeModal(activeModal);
        document.removeEventListener('keydown', handleEscapeKey);
    }
}

function closeAllModals() {
    const modals = ['postModal', 'profileModal', 'messagesModal', 'groupsModal', 'createGroupModal', 'friendRequestsModal', 'friendsModal', 'notificationsModal', 'adminPanelModal', 'createPostModal', 'createReelModal', 'editProfileModal', 'adminEditPostModal', 'callModal'];
    modals.forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (modal) modal.style.display = 'none';
    });
    activeModal = null;
    document.removeEventListener('keydown', handleEscapeKey);
}

function closePostModal() { closeModal('postModal'); }
function closeProfileModal() { closeModal('profileModal'); }
function closeMessagesModal() { closeModal('messagesModal'); currentChatUser = null; }
function closeGroupsModal() { closeModal('groupsModal'); currentGroup = null; }
function closeCreateGroupModal() { closeModal('createGroupModal'); }
function closeFriendRequestsModal() { closeModal('friendRequestsModal'); }
function closeFriendsModal() { closeModal('friendsModal'); }
function closeNotificationsModal() { closeModal('notificationsModal'); }
function closeCreateReelModal() { closeModal('createReelModal'); }
function closeEditProfileModal() { closeModal('editProfileModal'); }
function closeAdminPanel() { closeModal('adminPanelModal'); }
function closeAdminEditPostModal() { closeModal('adminEditPostModal'); }

function openFriends() { openModal('friendsModal'); loadFriends(); }
function closeFriendsModal() { closeModal('friendsModal'); }
function openFriendRequests() { openModal('friendRequestsModal'); loadFriendRequests(); }
function closeFriendRequestsModal() { closeModal('friendRequestsModal'); }

async function loadFriends() {
    const friends = await getFriendsList();
    const container = document.getElementById('friendsList');
    if (!container) return;
    if (friends.length === 0) {
        container.innerHTML = '<div class="empty-state">No friends yet</div>';
        return;
    }
    container.innerHTML = friends.map(friend => `
        <div class="friend-item" onclick="viewProfile('${friend.username}')">
            <img src="${friend.avatar || `https://ui-avatars.com/api/?name=${friend.username}&background=2563eb&color=fff`}" class="friend-avatar">
            <div class="friend-info">
                <div class="friend-name">${escapeHtml(friend.username)}</div>
            </div>
            <button class="btn-small" onclick="event.stopPropagation(); startChat('${friend.id}')">Message</button>
        </div>
    `).join('');
}

async function loadFriendRequests() {
    try {
        const response = await fetch('/api/friend-requests');
        const requests = await response.json();
        const container = document.getElementById('friendRequestsList');
        if (!container) return;
        if (requests.length === 0) {
            container.innerHTML = '<div class="empty-state">No requests</div>';
            return;
        }
        container.innerHTML = requests.map(req => `
            <div class="friend-request-item">
                <img src="${req.avatar || `https://ui-avatars.com/api/?name=${req.username}&background=2563eb&color=fff`}" class="request-avatar">
                <div class="request-info">
                    <div class="request-name">${escapeHtml(req.username)}</div>
                </div>
                <div class="request-actions">
                    <button class="accept-btn" onclick="acceptFriendRequest('${req.id}')">Accept</button>
                    <button class="decline-btn" onclick="declineFriendRequest('${req.id}')">Decline</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error:', error);
    }
}

// ============ UTILITY FUNCTIONS ============
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
}

function setupEventListeners() {
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAllModals();
    });
}

function setupInfiniteScroll() {
    window.addEventListener('scroll', () => {
        if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) {
            if (currentView === 'feed' && hasMorePosts && !isLoadingMore) {
                loadFeed(true);
            }
        }
    });
}

async function loadProfileFromURL() {
    const path = window.location.pathname;

    // Handle hashtag pages
    if (path.startsWith('/hashtag/')) {
        const hashtag = path.substring(9);
        await loadPostsByHashtag(hashtag);
        return true;
    }

    // Handle profile pages
    if (path.startsWith('/@')) {
        const username = path.substring(2);
        if (username && username !== currentUser?.username) {
            // Open profile in modal instead of full page load
            await viewProfile(username);
        }
        return true;
    }

    // Handle home page
    if (path === '/' || path === '') {
        await loadFeed();
        return true;
    }

    return false;
}

// ============ LOGOUT ============
async function logout() {
    if (socket) socket.disconnect();
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
}

// ============ HASHTAG FUNCTIONS ============

function linkify(text) {
    if (!text) return '';

    let html = escapeHtml(text);

    // Convert URLs to links
    html = html.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="link">$1</a>');

    // Convert hashtags to clickable spans with quick load
    html = html.replace(/#(\w+)/g, '<span class="hashtag" onclick="event.stopPropagation(); handleHashtag(\'$1\', event)">#$1</span>');

    // Convert mentions
    html = html.replace(/@(\w+)/g, '<span class="mention" onclick="event.stopPropagation(); viewProfile(\'$1\')">@$1</span>');

    return html;
}

// ============ FIXED TRENDING HASHTAGS ============
async function loadTrendingHashtags() {
    try {
        const response = await fetch('/api/trending');
        const trending = await response.json();
        const container = document.getElementById('trendingHashtagsList');

        if (!container) {
            console.log('Trending container not found');
            return;
        }

        if (!trending || trending.length === 0) {
            container.innerHTML = '<div class="no-trending">No trending hashtags yet. Create posts with #hashtags!</div>';
            return;
        }

        // In loadTrendingHashtags function, update the onclick
        container.innerHTML = trending.map((item, index) => `
            <div class="trending-item" onclick="handleHashtag('${item.tag.replace('#', '')}', event)">
                <div class="trending-rank">${index + 1}</div>
                <div class="trending-info">
                    <div class="trending-topic">${escapeHtml(item.tag)}</div>
                    <div class="trending-count">${item.posts || item.count} posts</div>
                </div>
            </div>
        `).join('');

        console.log('Trending loaded:', trending.length);
    } catch (error) {
        console.error('Error loading trending:', error);
        const container = document.getElementById('trendingHashtagsList');
        if (container) {
            container.innerHTML = '<div class="no-trending">Unable to load trending</div>';
        }
    }
}

// Handle browser navigation (back/forward buttons)
window.addEventListener('popstate', async () => {
    const path = window.location.pathname;

    if (path.startsWith('/hashtag/')) {
        const hashtag = path.substring(9);
        await loadPostsByHashtag(hashtag);
    } else if (path.startsWith('/@')) {
        const username = path.substring(2);
        await viewProfile(username);
    } else {
        await loadFeed();
    }
});

// ============ QUICK LOAD WITHOUT PAGE RELOAD ============
// ============ QUICK LOAD WITHOUT PAGE RELOAD ============
async function quickLoad(path) {
    showLoading();

    if (path === '/' || path === '/home' || path === '') {
        await loadFeed();
        window.history.pushState({}, '', '/');
        document.title = 'Social Vault - Home';
    }
    else if (path.startsWith('/@')) {
        const username = path.substring(2);
        await loadFeed(); // Load feed in background
        await viewProfile(username, false);
        document.title = `${username} | Social Vault`;
    }
    else if (path.startsWith('/hashtag/')) {
        const hashtag = path.substring(9);
        await loadPostsByHashtag(hashtag);
        document.title = `#${hashtag} | Social Vault`;
    }

    hideLoading();
}

// Override link clicks for smooth navigation
document.addEventListener('click', function (e) {
    // Find closest anchor tag
    const anchor = e.target.closest('a');
    if (anchor && anchor.getAttribute('href')) {
        const href = anchor.getAttribute('href');
        // Handle internal links
        if (href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/login') && !href.startsWith('/register')) {
            e.preventDefault();
            quickLoad(href);
        }
    }
});

// Handle browser navigation (back/forward buttons) - FAST
window.addEventListener('popstate', async () => {
    const path = window.location.pathname;

    if (path.startsWith('/hashtag/')) {
        const hashtag = path.substring(9);
        await loadPostsByHashtag(hashtag);
    } else if (path.startsWith('/@')) {
        const username = path.substring(2);
        await loadFeed();
        await viewProfile(username, false);
    } else {
        await loadFeed();
    }
});

// ============ SEARCH USERS AND POSTS ============

// Debounce function to avoid too many API calls
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Perform search
async function performSearch(query) {
    if (!query || query.length < 2) {
        const resultsDiv = document.getElementById('searchResults');
        if (resultsDiv) resultsDiv.style.display = 'none';
        return;
    }

    try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await response.json();

        const resultsDiv = document.getElementById('searchResults');
        if (!resultsDiv) return;

        let html = '';

        // Users section
        if (data.users && data.users.length > 0) {
            html += '<div class="search-category"><i class="fas fa-users"></i> Users</div>';
            html += data.users.map(user => `
                <div class="search-result-item" onclick="viewProfile('${user.username}'); document.getElementById('searchResults').style.display='none'; document.getElementById('searchInput').value = '';">
                    <img src="${user.avatar || `https://ui-avatars.com/api/?name=${user.username}&background=2563eb&color=fff`}" class="search-result-avatar">
                    <div class="search-result-info">
                        <div class="search-result-name">${escapeHtml(user.username)}</div>
                        <div class="search-result-bio">${escapeHtml(user.bio?.substring(0, 50) || 'No bio')}</div>
                    </div>
                </div>
            `).join('');
        }

        // Posts section
        if (data.posts && data.posts.length > 0) {
            html += '<div class="search-category"><i class="fas fa-newspaper"></i> Posts</div>';
            html += data.posts.map(post => `
                <div class="search-result-item" onclick="viewPost('${post.id}'); document.getElementById('searchResults').style.display='none'; document.getElementById('searchInput').value = '';">
                    <div class="search-result-icon">
                        <i class="fas fa-file-alt"></i>
                    </div>
                    <div class="search-result-info">
                        <div class="search-result-name">${escapeHtml(post.title)}</div>
                        <div class="search-result-bio">By ${escapeHtml(post.author)} | ${getTimeAgo(post.createdAt)}</div>
                    </div>
                </div>
            `).join('');
        }

        if (html === '') {
            html = '<div class="search-no-results">No users or posts found for "${escapeHtml(query)}"</div>';
        }

        resultsDiv.innerHTML = html;
        resultsDiv.style.display = 'block';

    } catch (error) {
        console.error('Search error:', error);
        const resultsDiv = document.getElementById('searchResults');
        if (resultsDiv) {
            resultsDiv.innerHTML = '<div class="search-error">Search failed. Please try again.</div>';
            resultsDiv.style.display = 'block';
        }
    }
}

// Debounced search
const debouncedSearch = debounce(performSearch, 300);

// Setup search input listener
function setupSearch() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;

    // Remove existing listener to avoid duplicates
    searchInput.removeEventListener('input', handleSearchInput);
    searchInput.addEventListener('input', handleSearchInput);

    // Clear search on escape key
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchInput.value = '';
            const resultsDiv = document.getElementById('searchResults');
            if (resultsDiv) resultsDiv.style.display = 'none';
        }
    });
}

function handleSearchInput(e) {
    const query = e.target.value.trim();
    debouncedSearch(query);
}

// Close search results when clicking outside
document.addEventListener('click', (e) => {
    const searchBar = document.querySelector('.search-bar');
    const resultsDiv = document.getElementById('searchResults');
    if (searchBar && resultsDiv && !searchBar.contains(e.target)) {
        resultsDiv.style.display = 'none';
    }
});

// ============ MOBILE MENU TOGGLE ============
function toggleMobileSidebar() {
    console.log('Toggle button clicked');

    if (window.innerWidth > 768) {
        console.log('Desktop mode, ignoring');
        return;
    }

    const leftSidebar = document.querySelector('.left-sidebar');
    const overlay = document.getElementById('sidebarOverlay');

    if (!leftSidebar) {
        console.error('Sidebar not found');
        return;
    }

    // Force inline style to ensure it works
    const computedLeft = window.getComputedStyle(leftSidebar).left;
    console.log('Current left position:', computedLeft);

    if (computedLeft === '0px' || leftSidebar.classList.contains('mobile-open')) {
        // Close sidebar
        leftSidebar.classList.remove('mobile-open');
        leftSidebar.style.left = '-280px';
        if (overlay) {
            overlay.classList.remove('active');
            overlay.style.display = 'none';
        }
        document.body.style.overflow = '';
        console.log('Sidebar closed');
    } else {
        // Open sidebar
        leftSidebar.classList.add('mobile-open');
        leftSidebar.style.left = '0px';
        if (overlay) {
            overlay.classList.add('active');
            overlay.style.display = 'block';
        }
        document.body.style.overflow = 'hidden';
        console.log('Sidebar opened');
    }
}

// Also add a function to close sidebar when clicking overlay
function closeMobileSidebar() {
    const leftSidebar = document.querySelector('.left-sidebar');
    const overlay = document.getElementById('sidebarOverlay');

    if (leftSidebar) {
        leftSidebar.classList.remove('mobile-open');
        leftSidebar.style.left = '-280px';
    }
    if (overlay) {
        overlay.classList.remove('active');
        overlay.style.display = 'none';
    }
    document.body.style.overflow = '';
}

// Initialize overlay click handler
function setupMobileSidebar() {
    const overlay = document.getElementById('sidebarOverlay');
    if (overlay) {
        overlay.onclick = closeMobileSidebar;
    }
}

// Call this in your initialization
setupMobileSidebar();

function handleResize() {
    if (window.innerWidth > 768) {
        const leftSidebar = document.querySelector('.left-sidebar');
        const overlay = document.getElementById('sidebarOverlay');

        if (leftSidebar) {
            leftSidebar.classList.remove('mobile-open');
        }
        if (overlay) {
            overlay.classList.remove('active');
        }
        document.body.style.overflow = '';
    }
}

// Call this in your initialization
function initMobileFeatures() {
    setupMobileSidebar();
    console.log('Mobile features initialized');
}

// Debug function to check sidebar state
function checkSidebarState() {
    const leftSidebar = document.querySelector('.left-sidebar');
    console.log('Sidebar element:', leftSidebar);
    console.log('Sidebar classes:', leftSidebar ? leftSidebar.className : 'not found');
    console.log('Has mobile-open class:', leftSidebar ? leftSidebar.classList.contains('mobile-open') : false);
    console.log('Window width:', window.innerWidth);
}

// ============ MOBILE MENU FUNCTIONS ============
// ============ MOBILE MENU FUNCTIONS ============
function openMobileMenu() {
    const sidebar = document.getElementById('mobileMenuSidebar');
    const overlay = document.getElementById('mobileMenuOverlay');

    if (sidebar) {
        sidebar.classList.add('open');
    }
    if (overlay) {
        overlay.classList.add('active');
    }
    document.body.style.overflow = 'hidden';
}

function closeMobileMenu() {
    const sidebar = document.getElementById('mobileMenuSidebar');
    const overlay = document.getElementById('mobileMenuOverlay');

    if (sidebar) {
        sidebar.classList.remove('open');
    }
    if (overlay) {
        overlay.classList.remove('active');
    }
    document.body.style.overflow = '';
}

// Update mobile menu with user info
function updateMobileMenu() {
    const avatar = document.getElementById('mobileMenuAvatar');
    const username = document.getElementById('mobileMenuUsername');
    const adminMenu = document.getElementById('mobileAdminMenu');

    if (avatar && currentUser) {
        avatar.src = currentUser.avatar || `https://ui-avatars.com/api/?name=${currentUser.username}&background=2563eb&color=fff`;
    }
    if (username && currentUser) {
        username.textContent = currentUser.username;
    }
    if (adminMenu && currentUser && currentUser.role === 'admin') {
        adminMenu.style.display = 'block';
    }
}

// ============ VOICE CALLS - FIXED ============
async function startCall(userId, type) {
    // Check if microphone is available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast('Your browser does not support voice calls', 'error');
        return;
    }

    // Get user info
    let userInfo = null;
    try {
        const response = await fetch(`/api/users/id/${userId}`);
        const data = await response.json();
        userInfo = data.user;
    } catch (error) {
        console.error('Error getting user info:', error);
    }

    // Show call modal
    showCallModal(`Calling ${userInfo?.username || 'user'}...`);
    document.getElementById('callWithName').textContent = `Calling ${userInfo?.username || 'user'}...`;
    if (userInfo?.avatar) {
        document.getElementById('callAvatar').src = userInfo.avatar;
    }

    try {
        // Request microphone access
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('Microphone access granted');

        // Initiate call on server
        const response = await fetch('/api/calls/initiate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: userId, callType: type })
        });

        const data = await response.json();
        if (data.success) {
            currentCall = {
                id: data.callId,
                to: userId,
                toUsername: userInfo?.username,
                type: type
            };
            setupPeerConnection();
            document.getElementById('callStatus').textContent = 'Ringing...';
            document.getElementById('acceptCallBtn').style.display = 'none';
            document.getElementById('rejectCallBtn').style.display = 'inline-block';
            document.getElementById('endCallBtn').style.display = 'inline-block';
        } else {
            throw new Error(data.error || 'Failed to initiate call');
        }
    } catch (error) {
        console.error('Error starting call:', error);
        let errorMessage = 'Unable to access microphone. ';
        if (error.name === 'NotAllowedError') {
            errorMessage += 'Please grant microphone permission in your browser settings.';
        } else if (error.name === 'NotFoundError') {
            errorMessage += 'No microphone found on your device.';
        } else {
            errorMessage += error.message;
        }
        showToast(errorMessage, 'error');
        closeCallModal();
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
    }
}

function setupPeerConnection(isAnswer = false) {
    if (!localStream) {
        console.error('No local stream available');
        return;
    }

    peerConnection = new RTCPeerConnection(CONFIG.ICE_SERVERS);

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
        const remoteAudio = new Audio();
        remoteAudio.srcObject = event.streams[0];
        remoteAudio.play().catch(console.error);
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate && socket) {
            socket.emit('webrtc_signal', {
                to: isAnswer ? currentCall.from : currentCall.to,
                signal: event.candidate
            });
        }
    };

    if (!isAnswer && currentCall) {
        peerConnection.createOffer()
            .then(offer => peerConnection.setLocalDescription(offer))
            .then(() => {
                if (socket && currentCall) {
                    socket.emit('webrtc_signal', {
                        to: currentCall.to,
                        signal: peerConnection.localDescription
                    });
                }
            })
            .catch(console.error);
    }
}

function showCallModal(message) {
    const modal = document.getElementById('callModal');
    if (modal) {
        modal.style.display = 'flex';
        document.getElementById('callStatus').textContent = message;
    }
}

function closeCallModal() {
    const modal = document.getElementById('callModal');
    if (modal) modal.style.display = 'none';
}

function endCall() {
    if (currentCall?.id) {
        fetch('/api/calls/end', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callId: currentCall.id })
        }).catch(console.error);
    }

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    closeCallModal();
    currentCall = null;
}

// Call this in your showMainApp function
// Add: updateMobileMenu();

// Call this after toggle


// ============ MOBILE BOTTOM NAVIGATION ============
function navigateToMobile(view) {
    // Update active state on bottom nav
    document.querySelectorAll('.bottom-nav-item').forEach(item => {
        item.classList.remove('active');
    });
    const activeItem = document.querySelector(`.bottom-nav-item[data-nav="${view}"]`);
    if (activeItem) activeItem.classList.add('active');

    // Navigate based on view
    switch (view) {
        case 'feed':
            window.location.href = '/';
            break;
        case 'reels':
            window.location.href = '/reels';
            break;
        case 'create':
            openCreatePostModal();
            break;
        case 'messages':
            openMessages();
            break;
        case 'profile':
            viewProfile(currentUser?.username);
            break;
        default:
            window.location.href = '/';
    }
}

// Update bottom nav active state based on current page
function updateBottomNavActive() {
    const path = window.location.pathname;
    let activeNav = 'feed';

    if (path === '/reels') {
        activeNav = 'reels';
    } else if (path === '/') {
        activeNav = 'feed';
    }

    document.querySelectorAll('.bottom-nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('data-nav') === activeNav) {
            item.classList.add('active');
        }
    });
}

// Call this in your checkAuth after loading the page

async function loadReelsFeed(loadMore = false) {
    if (isLoadingReels) return;

    // Only change URL if we're not already on reels
    if (window.location.pathname !== '/reels') {
        window.history.pushState({}, '', '/reels');
    }
    document.title = 'Reels | Social Vault';
    currentView = 'reels';
    updateActiveMenuItems();

    if (!loadMore) {
        currentReelIndex = 0;
        hasMoreReels = true;
        reelCursor = null;
        reelsData = [];
        showLoading();
    }

    isLoadingReels = true;

    try {
        const url = `/api/reels/feed?limit=5${reelCursor ? `&cursor=${reelCursor}` : ''}`;
        console.log('Fetching reels from:', url);

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        console.log('Reels data received:', data.reels?.length);

        if (data.reels && data.reels.length > 0) {
            if (loadMore) {
                reelsData = [...reelsData, ...data.reels];
                appendReelsToContainer(data.reels);
            } else {
                reelsData = data.reels;
                renderReelsContainer(data.reels);
            }
            reelCursor = data.nextCursor;
            hasMoreReels = data.hasMore;
        } else {
            hasMoreReels = false;
            if (!loadMore) {
                showEmptyReelsState();
            }
        }
    } catch (error) {
        console.error('Error loading reels:', error);
        showToast('Failed to load reels: ' + error.message, 'error');
        const container = document.getElementById('feedContainer');
        if (container && !loadMore) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h3>Failed to load reels</h3>
                    <p>${error.message}</p>
                    <button class="btn-primary" onclick="location.reload()">Retry</button>
                </div>
            `;
        }
    }

    isLoadingReels = false;
    if (!loadMore) hideLoading();
}

function renderReelsContainer(reels) {
    const container = document.getElementById('feedContainer');
    if (!container) return;

    container.innerHTML = `
        <div class="reels-container" id="reelsContainer">
            ${reels.map((reel, index) => createReelHTML(reel, index)).join('')}
            <div id="reelsLoader" class="reels-loading" style="display: none;">Loading more...</div>
        </div>
    `;

    setupReelObservers();
    setupScrollListener();
}

function appendReelsToContainer(reels) {
    const container = document.getElementById('reelsContainer');
    if (!container) return;

    const loader = document.getElementById('reelsLoader');
    if (loader) loader.remove();

    const startIndex = reelsData.length - reels.length;
    reels.forEach((reel, idx) => {
        container.insertAdjacentHTML('beforeend', createReelHTML(reel, startIndex + idx));
    });

    container.insertAdjacentHTML('beforeend', '<div id="reelsLoader" class="reels-loading" style="display: none;">Loading more...</div>');
    setupReelObservers();
}

function showEmptyReelsState() {
    const container = document.getElementById('feedContainer');
    if (container) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-film"></i>
                <h3>No reels yet</h3>
                <p>Be the first to create a reel!</p>
                <button class="btn-primary" onclick="openCreateReelModal()">Create Reel</button>
            </div>
        `;
    }
}

// Manual play when user clicks anywhere on reel
function setupManualPlay() {
    document.addEventListener('click', (e) => {
        const reelItem = e.target.closest('.reel-item');
        if (reelItem) {
            const video = reelItem.querySelector('video');
            if (video && video.paused) {
                video.play().catch(err => console.log('Manual play error:', err));
            }
        }
    });
}

// Call this in initReelsPage
function initReelsPage() {
    loadReelsFeed();
    setupManualPlay();
}

// ============ CUSTOM ALERT POPUP ============
function showCustomAlert(message, type = 'info', duration = 3000) {
    // Remove existing alerts
    const existingAlerts = document.querySelectorAll('.custom-alert');
    existingAlerts.forEach(alert => alert.remove());

    const alert = document.createElement('div');
    alert.className = `custom-alert ${type}`;

    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-check-circle';
    if (type === 'error') icon = 'fa-exclamation-circle';

    alert.innerHTML = `
        <i class="fas ${icon}"></i>
        <span>${message}</span>
    `;

    document.body.appendChild(alert);

    setTimeout(() => {
        alert.style.opacity = '0';
        setTimeout(() => alert.remove(), 300);
    }, duration);
}

// Replace all showToast calls with showCustomAlert for better visibility
// Or keep both and use showCustomAlert for important messages

// ============ SPA-LIKE NAVIGATION ============
async function navigateToPage(path, updateHistory = true) {
    showLoading();

    try {
        if (path === '/' || path === '/home' || path === '') {
            currentView = 'feed';
            await loadFeed();
            if (updateHistory) window.history.pushState({}, '', '/');
            document.title = 'Social Vault - Home';
            updateActiveMenuItems();
        }
        else if (path === '/reels') {
            currentView = 'reels';
            await loadReelsFeed();
            if (updateHistory) window.history.pushState({}, '', '/reels');
            document.title = 'Reels | Social Vault';
            updateActiveMenuItems();
        }
        else if (path.startsWith('/@')) {
            const username = path.substring(2);
            currentView = 'profile';
            await loadFeed(); // Keep feed in background
            await viewProfile(username, false);
            if (updateHistory) window.history.pushState({}, '', path);
            document.title = `${username} | Social Vault`;
        }
        else if (path.startsWith('/hashtag/')) {
            const hashtag = path.substring(9);
            currentView = 'hashtag';
            await loadPostsByHashtag(hashtag);
            if (updateHistory) window.history.pushState({}, '', path);
            document.title = `#${hashtag} | Social Vault`;
        }
    } catch (error) {
        console.error('Navigation error:', error);
        showCustomAlert('Failed to load page', 'error');
    }

    hideLoading();
}

// Update navigateTo function
function navigateTo(view) {
    if (view === 'feed') {
        navigateToPage('/');
    } else if (view === 'reels') {
        navigateToPage('/reels');
    } else if (view === 'friends') {
        openFriends();
    }
}

// Update navigateToMobile function
function navigateToMobile(view) {
    // Update active state on bottom nav
    document.querySelectorAll('.bottom-nav-item').forEach(item => {
        item.classList.remove('active');
    });
    const activeItem = document.querySelector(`.bottom-nav-item[data-nav="${view}"]`);
    if (activeItem) activeItem.classList.add('active');

    // Navigate based on view
    switch (view) {
        case 'feed':
            navigateToPage('/');
            break;
        case 'reels':
            navigateToPage('/reels');
            break;
        case 'create':
            openCreatePostModal();
            break;
        case 'messages':
            openMessages();
            break;
        case 'profile':
            navigateToPage(`/@${currentUser?.username}`);
            break;
        default:
            navigateToPage('/');
    }
}

// Update viewProfile function to handle navigation properly
async function viewProfile(username, updateHistory = true) {
    const newUrl = `/@${username}`;
    if (updateHistory) {
        window.history.pushState({}, '', newUrl);
    }
    document.title = `${username} | Social Vault`;
    currentView = 'profile';

    showLoading();
    try {
        const response = await fetch(`/api/@${username}`);
        const data = await response.json();

        if (data.user) {
            const modal = document.getElementById('profileModal');
            const content = document.getElementById('profileContent');
            const isOwnProfile = currentUser?.username === username;

            let isFollowing = false;
            if (currentUser && !isOwnProfile) {
                const friendsList = await getFriendsList();
                isFollowing = friendsList.some(f => f.id === data.user.id);
            }

            content.innerHTML = `
                <div class="profile-view">
                    <div class="profile-cover-area">
                        ${data.user.coverPhoto ? `<img src="${data.user.coverPhoto}" class="profile-cover">` : '<div class="profile-cover-placeholder"></div>'}
                    </div>
                    <div class="profile-avatar-large">
                        <img src="${data.user.avatar || `https://ui-avatars.com/api/?name=${data.user.username}&background=2563eb&color=fff&size=120`}">
                    </div>
                    <div class="profile-info">
                        <h2>${escapeHtml(data.user.username)}</h2>
                        <p class="profile-bio">${escapeHtml(data.user.bio || 'No bio yet')}</p>
                        <div class="profile-stats">
                            <div><strong>${data.user.friends?.length || 0}</strong> Friends</div>
                            <div><strong>${data.posts?.length || 0}</strong> Posts</div>
                            <div><strong>${data.reels?.length || 0}</strong> Reels</div>
                        </div>
                        ${!isOwnProfile ? `
                            <div class="profile-actions">
                                ${!isFollowing ?
                        `<button class="btn-primary" onclick="sendFriendRequest('${data.user.id}')">Add Friend</button>` :
                        `<button class="btn-secondary" onclick="removeFriend('${data.user.id}')">Unfriend</button>`
                    }
                                <button class="btn-primary" onclick="startChat('${data.user.id}')">Message</button>
                            </div>
                        ` : `
                            <button class="btn-secondary" onclick="openSettings()">Edit Profile</button>
                        `}
                    </div>
                    <div class="profile-posts">
                        <h3>Posts</h3>
                        ${data.posts.length === 0 ? '<p>No posts yet</p>' :
                    data.posts.map(post => `
                                <div class="mini-post" onclick="viewPost('${post.id}')">
                                    <div class="post-title">${escapeHtml(post.title)}</div>
                                    <div class="post-time">${getTimeAgo(post.createdAt)}</div>
                                </div>
                            `).join('')
                }
                    </div>
                </div>
            `;

            openModal('profileModal');
        }
    } catch (error) {
        console.error('Error loading profile:', error);
        showCustomAlert('Failed to load profile', 'error');
    }
    hideLoading();
}

// Update closeProfileModal to restore URL correctly
function closeProfileModal() {
    closeModal('profileModal');
    // Restore previous URL based on current view
    if (currentView === 'feed') {
        window.history.pushState({}, '', '/');
        document.title = 'Social Vault - Home';
    } else if (currentView === 'reels') {
        window.history.pushState({}, '', '/reels');
        document.title = 'Reels | Social Vault';
    }
    updateActiveMenuItems();
}

// Update the checkAuth function to use navigateToPage
async function checkAuth() {
    showLoading();
    try {
        const response = await fetch('/api/me');
        if (response.ok) {
            const data = await response.json();
            currentUser = data.user;
            console.log('User authenticated:', currentUser.username);

            showMainApp();
            initMobileFeatures();
            setupSocket();

            await loadTrendingHashtags();

            // Handle routing based on URL
            const path = window.location.pathname;

            if (path === '/reels') {
                await navigateToPage('/reels', false);
            } else if (path === '/' || path === '') {
                await navigateToPage('/', false);
            } else if (path.startsWith('/@')) {
                await navigateToPage(path, false);
            } else if (path.startsWith('/hashtag/')) {
                await navigateToPage(path, false);
            } else {
                await navigateToPage('/', false);
            }

            setupEventListeners();
            setupInfiniteScroll();

            if (socket) {
                socket.emit('user_online', currentUser.id);
            }

            if (currentUser.role === 'admin') {
                const adminMenu = document.getElementById('adminMenuLink');
                if (adminMenu) adminMenu.style.display = 'block';
                const mobileAdminMenu = document.getElementById('mobileAdminMenu');
                if (mobileAdminMenu) mobileAdminMenu.style.display = 'block';
            }
        } else {
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('Auth check error:', error);
        window.location.href = '/login';
    }
    hideLoading();
}

// Handle popstate for back/forward buttons
window.addEventListener('popstate', async () => {
    const path = window.location.pathname;
    await navigateToPage(path, false);
});

// Handle opening shared posts/reels from URL
async function handleSharedContent() {
    const path = window.location.pathname;

    if (path.startsWith('/post/')) {
        const postId = path.substring(6);
        await viewPost(postId);
        return true;
    }

    if (path.startsWith('/reel/')) {
        const reelId = path.substring(6);
        // You may need to create a viewReelById function
        showToast('Opening reel...', 'info');
        return true;
    }

    return false;
}

// Force update all avatars on the page
function updateAllAvatars(newAvatarUrl) {
    // Update current user's avatar reference
    if (currentUser) {
        currentUser.avatar = newAvatarUrl;
    }
    
    // Update all profile pictures in the DOM
    const avatarSelectors = [
        '.post-avatar',
        '.comment-avatar', 
        '.reel-author-avatar',
        '.friend-avatar',
        '.suggestion-avatar',
        '.online-avatar',
        '.chat-avatar',
        '.create-post-avatar',
        '.nav-avatar',
        '.mobile-menu-avatar'
    ];
    
    avatarSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(img => {
            // Check if this avatar belongs to current user
            const parent = img.closest('.post-card, .comment, .reel-card, .friend-item, .suggestion-item');
            if (parent) {
                const authorElement = parent.querySelector('.post-author, .comment-author, .reel-author-name, .friend-name, .suggestion-name');
                if (authorElement && authorElement.innerText === currentUser?.username) {
                    img.src = newAvatarUrl;
                }
            }
        });
    });
    
    // Also update navbar and mobile menu
    const navAvatar = document.getElementById('navAvatar');
    if (navAvatar) navAvatar.src = newAvatarUrl;
    
    const mobileMenuAvatar = document.getElementById('mobileMenuAvatar');
    if (mobileMenuAvatar) mobileMenuAvatar.src = newAvatarUrl;
}




console.log('Social Vault App Loaded');