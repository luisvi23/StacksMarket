const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  poll: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Poll',
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000
  },
  parentComment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Comment',
    default: null
  },
  replies: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Comment'
  }],
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  dislikes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  isEdited: {
    type: Boolean,
    default: false
  },
  editedAt: {
    type: Date
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date
  },
  // For moderation
  isFlagged: {
    type: Boolean,
    default: false
  },
  flagReason: {
    type: String,
    enum: ['spam', 'inappropriate', 'harassment', 'other'],
    default: null
  },
  flaggedBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reason: String,
    date: {
      type: Date,
      default: Date.now
    }
  }],
  // For user engagement
  userReputation: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Indexes for better query performance
commentSchema.index({ poll: 1, createdAt: -1 });
commentSchema.index({ user: 1, createdAt: -1 });
commentSchema.index({ parentComment: 1, createdAt: 1 });
commentSchema.index({ isDeleted: 1, isFlagged: 1 });

// Virtual for like count
commentSchema.virtual('likeCount').get(function() {
  return this.likes.length;
});

// Virtual for dislike count
commentSchema.virtual('dislikeCount').get(function() {
  return this.dislikes.length;
});

// Virtual for reply count
commentSchema.virtual('replyCount').get(function() {
  return this.replies.length;
});

// Method to like a comment
commentSchema.methods.like = function(userId) {
  if (!this.likes.includes(userId)) {
    this.likes.push(userId);
    // Remove from dislikes if present
    this.dislikes = this.dislikes.filter(id => id.toString() !== userId.toString());
  }
  return this.save();
};

// Method to dislike a comment
commentSchema.methods.dislike = function(userId) {
  if (!this.dislikes.includes(userId)) {
    this.dislikes.push(userId);
    // Remove from likes if present
    this.likes = this.likes.filter(id => id.toString() !== userId.toString());
  }
  return this.save();
};

// Method to flag a comment
commentSchema.methods.flag = function(userId, reason) {
  const existingFlag = this.flaggedBy.find(flag => flag.user.toString() === userId.toString());
  
  if (!existingFlag) {
    this.flaggedBy.push({
      user: userId,
      reason: reason,
      date: new Date()
    });
    
    // Auto-flag if multiple users flag
    if (this.flaggedBy.length >= 3) {
      this.isFlagged = true;
      this.flagReason = reason;
    }
  }
  
  return this.save();
};

// Method to soft delete
commentSchema.methods.softDelete = function() {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.content = '[Comment deleted]';
  return this.save();
};

// Static method to get comments for a poll
commentSchema.statics.getPollComments = async function(pollId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  
  const comments = await this.find({
    poll: pollId,
    parentComment: null,
    isDeleted: false
  })
  .populate('user', 'username avatar')
  .populate({
    path: 'replies',
    match: { isDeleted: false },
    populate: { path: 'user', select: 'username avatar' },
    options: { sort: { createdAt: 1 } }
  })
  .sort({ createdAt: -1 })
  .skip(skip)
  .limit(limit);
  
  const total = await this.countDocuments({
    poll: pollId,
    parentComment: null,
    isDeleted: false
  });
  
  return {
    comments,
    total,
    pages: Math.ceil(total / limit),
    currentPage: page
  };
};

module.exports = mongoose.model('Comment', commentSchema);
