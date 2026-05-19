# 🏦 Social Vault

### A Modern Social Media Platform | Share, Connect, Celebrate ✨

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18.x-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-blue.svg)](https://expressjs.com/)
[![Socket.io](https://img.shields.io/badge/Socket.io-4.x-black.svg)](https://socket.io/)

> **A complete, production-ready social media platform like Instagram + Twitter combined.** Share posts, create reels, chat with friends, and build your community — all with a beautiful modern interface.

---

## 🌟 Live Demo

> 🔗 **Live URL:** https://social-vault-qww2.onrender.com/ `Free Trial Save Data for limited time!`
> 
> **Warning:** `The preview don't save data! A good or localhost can save data!`
>
> Admin Details are in server.js
---

## ✨ Features

### 🎯 Core Features
| Feature | Description |
|---------|-------------|
| 🔐 **Authentication** | Secure login/register with bcrypt encryption |
| 📝 **Posts** | Create posts with text, images, videos (up to 10 files, 500MB each) |
| 🎬 **Reels** | Instagram-style short videos with sound toggle |
| 💬 **Comments** | Nested comments with likes and replies |
| ❤️ **Likes** | Double-tap or click to like posts and reels |
| 🔄 **Shares** | Share posts/reels to friends with clickable links |

### 👥 Social Features
| Feature | Description |
|---------|-------------|
| 👫 **Friends** | Send/accept/decline friend requests |
| 💬 **Real-time Chat** | 1-on-1 messaging with typing indicators |
| 🔔 **Notifications** | Real-time alerts for likes, comments, shares |

### 🎨 User Experience
| Feature | Description |
|---------|-------------|
| 🌙 **Dark Mode** | Toggle between light and dark themes |
| 📱 **Mobile Responsive** | Works perfectly on all devices |
| ⚡ **SPA Navigation** | Smooth page transitions like React |
| 🔍 **Search** | Find users and posts instantly |
| #️⃣ **Hashtags** | Clickable hashtags with trending section |
| 🖼️ **Image Lightbox** | Click images to view fullscreen |

### 👑 Admin Panel
| Feature | Description |
|---------|-------------|
| 👥 **User Management** | View all users, make/unmake admins |
| 🚫 **Ban/Suspend** | Ban users or suspend temporarily |
| ⚠️ **Warnings** | Issue warnings to users |
| 📝 **Post Management** | Edit or delete any post |
| 🗑️ **Delete Accounts** | Permanently delete user accounts |

---

## 🛠️ Tech Stack

| Category | Technologies |
|----------|--------------|
| **Backend** | Node.js, Express.js, Socket.io |
| **Frontend** | HTML5, CSS3, Vanilla JavaScript |
| **Database** | JSON file storage (lightweight) |
| **Authentication** | bcrypt, express-session |
| **File Upload** | Multer |
| **Real-time** | Socket.io |
| **Styling** | CSS3 with CSS Variables, Flexbox, Grid |

---

## 🚀 Quick Start

### Prerequisites
- Node.js (v16 or higher)
- npm (v8 or higher)

### Installation

```bash
# Clone the repository
git clone https://github.com/lossofcreativity/social-vault.git

# Navigate to project
cd social-vault

# Install dependencies
npm install

# Start the server
npm start

# Or run in development mode
npm run dev
