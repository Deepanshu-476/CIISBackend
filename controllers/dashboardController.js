







































































const CallLog = require("../models/CallLog");
const Lead = require("../models/Lead");
const FollowUp = require("../models/Followup");
const User = require("../models/User");


function getDateRange(range) {
  const now = new Date();
  let start, end;

  switch (range) {
    case "today":
      start = new Date(now.setHours(0, 0, 0, 0));
      end = new Date(now.setHours(23, 59, 59, 999));
      break;
    case "yesterday":
      start = new Date();
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setHours(23, 59, 59, 999);
      break;
    case "week":
      start = new Date();
      start.setDate(start.getDate() - 7);
      end = new Date();
      break;
    case "month":
      start = new Date();
      start.setDate(start.getDate() - 30);
      end = new Date();
      break;
    default: 
      return {};
  }

  return { start, end };
}


exports.getDashboardSummary = async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query.range);

    const callFilter = start && end ? { createdAt: { $gte: start, $lte: end } } : {};
    const leadFilter = start && end ? { createdAt: { $gte: start, $lte: end } } : {};
    const followFilter = start && end ? { date: { $gte: start, $lte: end } } : {};

    const [callsToday, leadsToday, followUpsToday] = await Promise.all([
      CallLog.countDocuments(callFilter),
      Lead.countDocuments(leadFilter),
      FollowUp.countDocuments({ ...followFilter, status: "pending" }),
    ]);

    const leadsByStatus = await Lead.aggregate([
      { $match: leadFilter },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 }
        }
      }
    ]);

    const agentCallCounts = await CallLog.aggregate([
      { $match: callFilter },
      {
        $group: {
          _id: "$agent",
          calls: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "agent"
        }
      },
      { $unwind: "$agent" },
      {
        $project: {
          _id: 0,
          agentName: "$agent.name",
          calls: 1
        }
      }
    ]);

    res.json({
      range: req.query.range || "all",
      calls: callsToday,
      leads: leadsToday,
      followUps: followUpsToday,
      leadsByStatus,
      agentCallCounts
    });

  } catch (err) {
    res.status(500).json({ msg: "Dashboard error", error: err.message });
  }
};

void 0;