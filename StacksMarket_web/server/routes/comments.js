const express = require('express');
const Comment = require('../models/Comment');
const Poll = require('../models/Poll');
const { auth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/comments/poll/:pollId
// @desc    Get comments for a poll
// @access  Public
router.get('/poll/:pollId', async (req, res) => {
  try {
    const { pollId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const result = await Comment.getPollComments(pollId, parseInt(page), parseInt(limit));

    res.json(result);
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/comments
// @desc    Create a new comment
// @access  Private
router.post('/', auth, async (req, res) => {
  try {
    const { pollId, content, parentCommentId } = req.body;

    // Validate required fields
    if (!pollId || !content || content.trim().length === 0) {
      return res.status(400).json({ message: 'Poll ID and content are required' });
    }

    // Check if poll exists
    const poll = await Poll.findById(pollId);
    if (!poll) {
      return res.status(404).json({ message: 'Poll not found' });
    }

    // Check if parent comment exists (for replies)
    if (parentCommentId) {
      const parentComment = await Comment.findById(parentCommentId);
      if (!parentComment) {
        return res.status(404).json({ message: 'Parent comment not found' });
      }
    }

    const comment = new Comment({
      poll: pollId,
      user: req.user._id,
      content: content.trim(),
      parentComment: parentCommentId || null
    });

    await comment.save();

    // Add to parent comment's replies if it's a reply
    if (parentCommentId) {
      await Comment.findByIdAndUpdate(parentCommentId, {
        $push: { replies: comment._id }
      });
    }

    // Populate user info
    await comment.populate('user', 'username avatar');

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`poll-${pollId}`).emit('comment-created', {
        pollId,
        comment
      });
    }

    res.status(201).json({
      message: 'Comment created successfully',
      comment
    });
  } catch (error) {
    console.error('Create comment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/comments/:id
// @desc    Update a comment
// @access  Private
router.put('/:id', auth, async (req, res) => {
  try {
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ message: 'Content is required' });
    }

    const comment = await Comment.findById(req.params.id);

    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    // Check if user owns the comment
    if (comment.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Update comment
    comment.content = content.trim();
    comment.isEdited = true;
    comment.editedAt = new Date();

    await comment.save();

    // Populate user info
    await comment.populate('user', 'username avatar');

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`poll-${comment.poll}`).emit('comment-updated', {
        pollId: comment.poll,
        comment
      });
    }

    res.json({
      message: 'Comment updated successfully',
      comment
    });
  } catch (error) {
    console.error('Update comment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/comments/:id
// @desc    Delete a comment
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);

    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    // Check if user owns the comment or is admin
    if (comment.user.toString() !== req.user._id.toString() && !req.user.isAdmin) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Soft delete the comment
    await comment.softDelete();

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`poll-${comment.poll}`).emit('comment-deleted', {
        pollId: comment.poll,
        commentId: comment._id
      });
    }

    res.json({ message: 'Comment deleted successfully' });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/comments/:id/like
// @desc    Like a comment
// @access  Private
router.post('/:id/like', auth, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);

    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    await comment.like(req.user._id);

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`poll-${comment.poll}`).emit('comment-reacted', {
        pollId: comment.poll,
        commentId: comment._id,
        likeCount: comment.likeCount,
        dislikeCount: comment.dislikeCount
      });
    }

    res.json({
      message: 'Comment liked successfully',
      likeCount: comment.likeCount,
      dislikeCount: comment.dislikeCount
    });
  } catch (error) {
    console.error('Like comment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/comments/:id/dislike
// @desc    Dislike a comment
// @access  Private
router.post('/:id/dislike', auth, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);

    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    await comment.dislike(req.user._id);

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`poll-${comment.poll}`).emit('comment-reacted', {
        pollId: comment.poll,
        commentId: comment._id,
        likeCount: comment.likeCount,
        dislikeCount: comment.dislikeCount
      });
    }

    res.json({
      message: 'Comment disliked successfully',
      likeCount: comment.likeCount,
      dislikeCount: comment.dislikeCount
    });
  } catch (error) {
    console.error('Dislike comment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/comments/:id/flag
// @desc    Flag a comment
// @access  Private
router.post('/:id/flag', auth, async (req, res) => {
  try {
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ message: 'Flag reason is required' });
    }

    const comment = await Comment.findById(req.params.id);

    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    await comment.flag(req.user._id, reason);

    res.json({
      message: 'Comment flagged successfully',
      isFlagged: comment.isFlagged
    });
  } catch (error) {
    console.error('Flag comment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/comments/user
// @desc    Get user's comments
// @access  Private
router.get('/user', auth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const comments = await Comment.find({
      user: req.user._id,
      isDeleted: false
    })
    .populate('poll', 'title category')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

    const total = await Comment.countDocuments({
      user: req.user._id,
      isDeleted: false
    });

    res.json({
      comments,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        total,
        hasNext: skip + comments.length < total,
        hasPrev: parseInt(page) > 1
      }
    });
  } catch (error) {
    console.error('Get user comments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
