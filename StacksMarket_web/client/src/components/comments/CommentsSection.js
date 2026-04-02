import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "react-query";
import axios from "../../setupAxios";
import { useAuth } from "../../contexts/AuthContext";
import LoadingSpinner from "../common/LoadingSpinner";
import { io } from "socket.io-client";
import { BACKEND_URL } from "../../contexts/Bakendurl";


const CommentItem = ({ comment, pollId, depth = 0 }) => {
  const queryClient = useQueryClient();
  const { user, isAuthenticated } = useAuth();
  const [showReply, setShowReply] = useState(false);
  const [replyContent, setReplyContent] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);

  const likeMutation = useMutation(
    async () => (await axios.post(`${BACKEND_URL}/api/comments/${comment._id}/like`)).data,
    {
      onSuccess: () => queryClient.invalidateQueries(["comments", pollId]),
    }
  );
  const dislikeMutation = useMutation(
    async () => (await axios.post(`${BACKEND_URL}/api/comments/${comment._id}/dislike`)).data,
    {
      onSuccess: () => queryClient.invalidateQueries(["comments", pollId]),
    }
  );
  const replyMutation = useMutation(
    async () =>
      (
        await axios.post(`${BACKEND_URL}/api/comments`, {
          pollId,
          content: replyContent,
          parentCommentId: comment._id,
        })
      ).data,
    {
      onSuccess: () => {
        setReplyContent("");
        setShowReply(false);
        queryClient.invalidateQueries(["comments", pollId]);
      },
    }
  );
  const updateMutation = useMutation(
    async () =>
      (
        await axios.put(`${BACKEND_URL}/api/comments/${comment._id}`, {
          content: editContent,
        })
      ).data,
    {
      onSuccess: () => {
        setIsEditing(false);
        queryClient.invalidateQueries(["comments", pollId]);
      },
    }
  );
  const deleteMutation = useMutation(
    async () => (await axios.delete(`${BACKEND_URL}/api/comments/${comment._id}`)).data,
    {
      onSuccess: () => queryClient.invalidateQueries(["comments", pollId]),
    }
  );

  const canEdit = useMemo(
    () => isAuthenticated && user?._id === comment.user?._id,
    [isAuthenticated, user, comment]
  );

  // Helper to truncate username for small screens
  const truncateUsername = (username) => {
    if (!username) return "User";
    return (
      <>
        <span className="hidden sm:inline">{username}</span>
        <span className="inline sm:hidden">
          {username.length > 8 ? `${username.slice(0, 8)}...` : username}
        </span>
      </>
    );
  };

  return (
    <div className={`flex gap-3 ${depth > 0 ? "mt-4 ml-8" : ""}`}>
      <div className="w-8 h-8 rounded-full bg-gray-300 overflow-hidden flex-shrink-0">
        {comment.user?.avatar && (
          <img
            src={comment.user.avatar}
            alt={comment.user.username}
            className="w-full h-full object-cover"
          />
        )}
      </div>
      <div className="flex-1">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-700 dark:text-gray-300">
              <span className="font-semibold">
                {truncateUsername(comment.user?.username)}
              </span>
              <span className="ml-2 text-xs text-gray-500">
                {new Date(comment.createdAt).toLocaleString()}
              </span>
            </div>
            {canEdit && (
              <div className="flex items-center gap-2 text-xs">
                {!isEditing && (
                  <button
                    className="text-primary-600"
                    onClick={() => setIsEditing(true)}
                  >
                    Edit
                  </button>
                )}
                <button
                  className="text-danger-600"
                  onClick={() => deleteMutation.mutate()}
                >
                  Delete
                </button>
              </div>
            )}
          </div>

          {!isEditing ? (
            <p className="mt-2 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
              {comment.content}
            </p>
          ) : (
            <div className="mt-2">
              <textarea
                className="input w-full h-20"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
              />
              <div className="flex gap-2 mt-2">
                <button
                  className="btn-primary btn-sm"
                  onClick={() => updateMutation.mutate()}
                  disabled={!editContent.trim()}
                >
                  Save
                </button>
                <button
                  className="btn-outline btn-sm"
                  onClick={() => {
                    setIsEditing(false);
                    setEditContent(comment.content);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center gap-4 mt-3 text-xs text-gray-600 dark:text-gray-400">
            <button
              onClick={() => likeMutation.mutate()}
              className="hover:text-primary-600"
            >
              Like ({comment.likeCount || (comment.likes?.length ?? 0)})
            </button>
            <button
              onClick={() => dislikeMutation.mutate()}
              className="hover:text-danger-600"
            >
              Dislike ({comment.dislikeCount || (comment.dislikes?.length ?? 0)}
              )
            </button>
            {isAuthenticated && (
              <button
                onClick={() => setShowReply((s) => !s)}
                className="hover:text-gray-800 dark:hover:text-gray-200"
              >
                Reply
              </button>
            )}
          </div>

          {showReply && (
            <div className="mt-3">
              <textarea
                className="input w-full h-20"
                placeholder={`Reply to ${comment.user?.username || "comment"}`}
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
              />
              <div className="flex gap-2 mt-2">
                <button
                  className="btn-primary btn-sm"
                  onClick={() => replyMutation.mutate()}
                  disabled={!replyContent.trim()}
                >
                  Post Reply
                </button>
                <button
                  className="btn-outline btn-sm"
                  onClick={() => {
                    setReplyContent("");
                    setShowReply(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {(comment.replies || [])
          .filter((r) => !r.isDeleted)
          .map((reply) => (
            <CommentItem
              key={reply._id}
              comment={reply}
              pollId={pollId}
              depth={depth + 1}
            />
          ))}
      </div>
    </div>
  );
};

const CommentsSection = ({ pollId }) => {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const [content, setContent] = useState("");
  const [page, setPage] = useState(1);
  const [limit] = useState(10);

  const { data, isLoading, isFetching } = useQuery(
    ["comments", pollId, page, limit],
    async () => {
      const res = await axios.get(
        `${BACKEND_URL}/api/comments/poll/${pollId}?page=${page}&limit=${limit}`
      );
      return res.data; // {comments, total, pages, currentPage}
    },
    { keepPreviousData: true, staleTime: 60 * 1000 }
  );

  const createMutation = useMutation(
    async () => (await axios.post(`${BACKEND_URL}/api/comments`, { pollId, content })).data,
    {
      onSuccess: () => {
        setContent("");
        queryClient.invalidateQueries(["comments", pollId]);
      },
    }
  );

  // Live updates via socket.io
  React.useEffect(() => {
    if (!pollId) return;
    const url = process.env.REACT_APP_SOCKET_URL || "http://localhost:5000";
    const socket = io(url, { transports: ["websocket"] });
    socket.emit("join-poll", pollId);
    const refresh = () => queryClient.invalidateQueries(["comments", pollId]);
    socket.on("comment-created", (payload) => {
      if (payload?.pollId === pollId) refresh();
    });
    socket.on("comment-updated", (payload) => {
      if (payload?.pollId === pollId) refresh();
    });
    socket.on("comment-deleted", (payload) => {
      if (payload?.pollId === pollId) refresh();
    });
    socket.on("comment-reacted", (payload) => {
      if (payload?.pollId === pollId) refresh();
    });
    return () => {
      socket.emit("leave-poll", pollId);
      socket.disconnect();
    };
  }, [pollId, queryClient]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-soft p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Comments
        </h3>
        <div className="text-sm text-gray-500">{data?.total || 0} total</div>
      </div>

      {/* New comment */}
      <div className="mb-6">
        <textarea
          className="input w-full h-24"
          placeholder={
            isAuthenticated ? "Write a comment..." : "Login to comment"
          }
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={!isAuthenticated}
        />
        <div className="flex justify-end mt-2">
          <button
            className="btn-primary"
            onClick={() => createMutation.mutate()}
            disabled={!isAuthenticated || !content.trim()}
          >
            Post Comment
          </button>
        </div>
      </div>

      {/* Comments list */}
      {isLoading ? (
        <div className="flex justify-center py-8">
          <LoadingSpinner />
        </div>
      ) : (
        <div className="space-y-6">
          {(data?.comments || []).map((c) => (
            <CommentItem key={c._id} comment={c} pollId={pollId} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {data?.pages > 1 && (
        <div className="flex justify-center mt-6 gap-2">
          <button
            className="btn-outline btn-sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || isFetching}
          >
            Previous
          </button>
          <span className="px-3 py-1 text-sm text-gray-600 dark:text-gray-400">
            Page {data.currentPage} of {data.pages}
          </span>
          <button
            className="btn-outline btn-sm"
            onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
            disabled={page >= data.pages || isFetching}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};

export default CommentsSection;
