const Task = require("../../models/Task");
const ActivityLog = require("../../models/ActivityLog");
const User = require("../../../models/User");
const callStore = require("../socket/callStore");

const CALL_TYPE_LABEL = (callType) => (callType === "video" ? "Video Call" : "Voice Call");

const formatDurationLabel = (seconds = 0) => {
    const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const hrs = Math.floor(safeSeconds / 3600);
    const mins = Math.floor((safeSeconds % 3600) / 60);
    const secs = safeSeconds % 60;
    const two = (v) => String(v).padStart(2, "0");
    return hrs > 0 ? `${two(hrs)}:${two(mins)}:${two(secs)}` : `${two(mins)}:${two(secs)}`;
};

const getCompanyCodeOf = (user) => {
    const raw = user?.companyCode || user?.company?.companyCode || "";
    return typeof raw === "string" ? raw.trim().toUpperCase() : "";
};

const getParticipantDisplayName = (room, userId, fallback = "User") => {
    const participant = room?.participants?.[String(userId)];
    return (
        participant?.user?.name ||
        participant?.invitedUser?.name ||
        fallback
    );
};

const createPersonalCallTask = async ({ userDoc, title, description, startTime }) => {
    if (!userDoc?._id) return null;
    const companyCode = getCompanyCodeOf(userDoc);
    if (!companyCode) return null;

    const userId = userDoc._id;
    const task = await Task.create({
        title: String(title || "Call").trim(),
        description: String(description || "").trim(),
        startDateTime: startTime,
        dueDateTime: null,
        priorityDays: "1",
        priority: "medium",
        companyCode,
        branch: userDoc.branch || null,
        assignedUsers: [userId],
        assignedGroups: [],
        statusByUser: [
            {
                user: userId,
                status: "in-progress",
                updatedAt: startTime,
                statusChangedAt: startTime,
                remarks: "Call in progress",
            },
        ],
        overallStatus: "in-progress",
        creatorStatus: {
            status: "in-progress",
            updatedAt: startTime,
        },
        createdBy: userId,
        taskFor: "self",
        statusHistory: [
            {
                status: "in-progress",
                changedBy: userId,
                changedByType: "user",
                changedAt: startTime,
                remarks: "Call started (in-progress)",
            },
        ],
        createdAt: startTime,
    });

    await ActivityLog.create({
        user: userId,
        action: "status_updated",
        task: task._id,
        description: `Updated task status to in-progress (${title})`,
        oldValues: { status: "pending" },
        newValues: { status: "in-progress" },
        createdAt: startTime,
    }).catch(() => {});

    return task;
};

const emitTaskNew = (io, userId, task) => {
    if (!io || !userId || !task) return;
    try {
        io.to(`user:${String(userId)}`).emit("task:new", task);
    } catch (_) {}
};

const loadUsersById = async (userIds = []) => {
    const cleanIds = [...new Set(userIds.map((id) => String(id || "")).filter(Boolean))];
    if (!cleanIds.length) return new Map();
    const docs = await User.find({ _id: { $in: cleanIds } })
        .select("name email companyCode company branch")
        .populate("company", "companyCode")
        .lean();
    return new Map(docs.map((doc) => [String(doc._id), doc]));
};

const onParticipantJoinedCall = async ({ io, room, joinedUserId, joinedAt = new Date() }) => {
    try {
        if (!room?.createTask || !joinedUserId) return;
        const callerId = String(room.hostUserId || "");
        const receiverId = String(joinedUserId);
        if (!callerId || !receiverId) return;

        room.taskIdsByUser = room.taskIdsByUser || {};
        room.taskJoinTimes = room.taskJoinTimes || {};
        room.taskFinalizedUsers = room.taskFinalizedUsers || {};
        room.taskPeerNames = room.taskPeerNames || {};

        const usersById = await loadUsersById([callerId, receiverId]);
        const callTypeLabel = CALL_TYPE_LABEL(room.callType);
        const startTime = joinedAt instanceof Date && !Number.isNaN(joinedAt.getTime())
            ? joinedAt
            : new Date();
        const callerName = usersById.get(callerId)?.name || getParticipantDisplayName(room, callerId, "Caller");
        const receiverName = usersById.get(receiverId)?.name || getParticipantDisplayName(room, receiverId, "Participant");

        // Create caller's personal task once when the first invitee answers.
        if (callerId !== receiverId && !room.taskIdsByUser[callerId]) {
            const callerDoc = usersById.get(callerId);
            const targetLabel = room.isGroupCall
                ? (room.title || receiverName)
                : receiverName;
            const callerTitle = `Called ${targetLabel} (${callTypeLabel})`;
            const callerDesc = `Outgoing ${room.callType === "video" ? "video" : "voice"} call to ${targetLabel}.`;
            const callerStart = room.answeredAt ? new Date(room.answeredAt) : startTime;
            const callerTask = await createPersonalCallTask({
                userDoc: callerDoc,
                title: callerTitle,
                description: callerDesc,
                startTime: callerStart,
            });
            if (callerTask?._id) {
                room.taskIdsByUser[callerId] = String(callerTask._id);
                room.taskJoinTimes[callerId] = callerStart.getTime();
                room.taskPeerNames[callerId] = targetLabel;
                delete room.taskFinalizedUsers[callerId];
                emitTaskNew(io, callerId, callerTask);
            }
        }

        // Create answering participant's personal task if they do not have an active one.
        if (!room.taskIdsByUser[receiverId] || room.taskFinalizedUsers[receiverId]) {
            const receiverDoc = usersById.get(receiverId);
            const receiverTitle = `Attended call from ${callerName} (${callTypeLabel})`;
            const receiverDesc = `Incoming ${room.callType === "video" ? "video" : "voice"} call attended from ${callerName}.`;
            const receiverTask = await createPersonalCallTask({
                userDoc: receiverDoc,
                title: receiverTitle,
                description: receiverDesc,
                startTime,
            });
            if (receiverTask?._id) {
                room.taskIdsByUser[receiverId] = String(receiverTask._id);
                room.taskJoinTimes[receiverId] = startTime.getTime();
                room.taskPeerNames[receiverId] = callerName;
                delete room.taskFinalizedUsers[receiverId];
                emitTaskNew(io, receiverId, receiverTask);
            }
        }

        await callStore.save(room);
    } catch (error) {
        console.error("Call task creation failed:", error?.message || error);
    }
};

const finalizeCallTasks = async ({ io, room, userIds = [], endedAt = new Date() }) => {
    try {
        if (!room?.createTask || !room?.taskIdsByUser) return;
        const targetIds = [...new Set(
            (userIds.length ? userIds : Object.keys(room.taskIdsByUser))
                .map((id) => String(id || ""))
                .filter(Boolean)
        )];
        if (!targetIds.length) return;

        room.taskFinalizedUsers = room.taskFinalizedUsers || {};
        let changed = false;

        for (const userId of targetIds) {
            const taskId = room.taskIdsByUser[userId];
            if (!taskId || room.taskFinalizedUsers[userId]) continue;

            const startMs = Number(room.taskJoinTimes?.[userId] || room.answeredAt || room.startedAt || endedAt.getTime());
            const rawEndMs = endedAt instanceof Date && !Number.isNaN(endedAt.getTime())
                ? endedAt.getTime()
                : Date.now();
            const safeEndTime = new Date(Math.max(rawEndMs, startMs + 1000));
            const durationSeconds = Math.max(0, Math.round((rawEndMs - startMs) / 1000));
            const durationLabel = formatDurationLabel(durationSeconds);

            const task = await Task.findById(taskId);
            if (!task) {
                room.taskFinalizedUsers[userId] = true;
                changed = true;
                continue;
            }

            if (task.overallStatus !== "completed") {
                const idx = task.statusByUser.findIndex(
                    (entry) => String(entry?.user?._id || entry?.user || "") === userId
                );
                if (idx === -1) {
                    task.statusByUser.push({
                        user: userId,
                        status: "completed",
                        updatedAt: safeEndTime,
                        statusChangedAt: safeEndTime,
                        remarks: `Call ended (${durationLabel})`,
                    });
                } else {
                    task.statusByUser[idx].status = "completed";
                    task.statusByUser[idx].updatedAt = safeEndTime;
                    task.statusByUser[idx].statusChangedAt = safeEndTime;
                    task.statusByUser[idx].remarks = `Call ended (${durationLabel})`;
                }

                task.overallStatus = "completed";
                task.completionDate = safeEndTime;
                task.creatorStatus = {
                    status: "completed",
                    updatedAt: safeEndTime,
                };
                task.statusHistory.push({
                    status: "completed",
                    changedBy: userId,
                    changedByType: "user",
                    changedAt: safeEndTime,
                    remarks: `Call ended (Active time: ${durationLabel})`,
                });
                await task.save();

                await ActivityLog.create({
                    user: userId,
                    action: "status_updated",
                    task: task._id,
                    description: `Updated task status to completed (Call ended - ${durationLabel})`,
                    oldValues: { status: "in-progress" },
                    newValues: { status: "completed" },
                    createdAt: safeEndTime,
                }).catch(() => {});
            }

            room.taskFinalizedUsers[userId] = true;
            changed = true;

            // Emit the remark popup ONLY to the exact socket where this user started/picked up the call
            // so Web stays on Web and Mobile App stays on Mobile App.
            const targetSocketId = room.participants?.[userId]?.socketId;
            if (io && targetSocketId) {
                const isCaller = userId === String(room.hostUserId || "");
                const peerName =
                    room.taskPeerNames?.[userId] ||
                    (isCaller ? room.title : getParticipantDisplayName(room, room.hostUserId, "Caller"));
                io.to(targetSocketId).emit("call:task-remark-prompt", {
                    callId: room.callId,
                    taskId: String(task._id),
                    taskTitle: task.title,
                    callType: room.callType,
                    role: isCaller ? "caller" : "receiver",
                    peerName: peerName || "User",
                    durationSeconds,
                    durationLabel,
                    startedAt: new Date(startMs).toISOString(),
                    endedAt: safeEndTime.toISOString(),
                });
            }
        }

        if (changed) {
            await callStore.save(room);
        }
    } catch (error) {
        console.error("Call task finalization failed:", error?.message || error);
    }
};

module.exports = {
    onParticipantJoinedCall,
    finalizeCallTasks,
};
