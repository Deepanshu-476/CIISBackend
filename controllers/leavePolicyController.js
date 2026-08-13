const mongoose = require("mongoose");
const LeaveType = require("../models/LeaveType");
const LeavePolicy = require("../models/LeavePolicy");
const Department = require("../models/Department");
const JobRole = require("../models/JobRole");
const User = require("../models/User");
const PagePermission = require("../models/PagePermission");
const Leave = require("../HR-CDS/models/Leave");

const companyIdFrom = (req) => req.user?.company?._id || req.user?.company || req.user?.companyId;
const companyCodeFrom = (req) => String(req.user?.companyCode || req.user?.company?.companyCode || "").trim().toUpperCase();
const validId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));
const fail = (res, status, message) => res.status(status).json({ success: false, message });
const normalize = (value) => String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
const normalizeRoleValue = (value) => String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
const overlapDays = (startA, endA, startB, endB) => {
  const start = new Date(Math.max(new Date(startA).getTime(), new Date(startB).getTime()));
  const end = new Date(Math.min(new Date(endA).getTime(), new Date(endB).getTime()));
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return start > end ? 0 : Math.floor((end - start) / 86400000) + 1;
};

const scope = (req, res) => {
  const company = companyIdFrom(req);
  const companyCode = companyCodeFrom(req);
  if (!validId(company) || !companyCode) {
    fail(res, 403, "A valid company account is required");
    return null;
  }
  return { company, companyCode };
};

const pageUserIds = (page, key) => (page?.[key] || [])
  .map(item => String(item?.user?._id || item?.user || ""))
  .filter(Boolean);

const isFallbackLeavePolicyManager = (user = {}) => {
  const roles = [user.companyRole, user.role, user.jobRole].map(normalizeRoleValue);
  return roles.some(role => ["owner", "admin", "hr", "super_admin", "superadmin", "company_owner", "companyowner"].includes(role));
};

const hasLeavePolicyPermission = async (req, permission) => {
  const company = companyIdFrom(req);
  const userId = String(req.user?._id || req.user?.id || "");
  if (!validId(company) || !userId) return false;

  // Company owners and administrative managers retain full control even
  // when a Page Management record contains explicit user assignments.
  if (isFallbackLeavePolicyManager(req.user)) return true;

  const page = await PagePermission.findOne({
    company,
    path: "/ciisUser/leave-policy"
  }).lean();

  if (!page) return false;

  if (permission === "delete") {
    return pageUserIds(page, "deleteUsers").includes(userId);
  }

  return pageUserIds(page, "editUsers").includes(userId);
};

const requireLeavePolicyPermission = (permission) => async (req, res, next) => {
  try {
    const allowed = await hasLeavePolicyPermission(req, permission);
    if (!allowed) {
      return fail(
        res,
        403,
        permission === "delete"
          ? "You do not have permission to delete leave policies. Configure Delete access in Page Management."
          : "You do not have permission to create or update leave policies. Configure Edit access in Page Management."
      );
    }
    next();
  } catch (error) {
    next(error);
  }
};

exports.getLeaveTypes = async (req, res, next) => {
  try {
    const companyScope = scope(req, res);
    if (!companyScope) return;
    const leaveTypes = await LeaveType.find({ company: companyScope.company })
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email")
      .sort({ sortOrder: 1, name: 1 }).lean();
    res.json({ success: true, leaveTypes });
  } catch (error) { next(error); }
};

exports.createLeaveType = async (req, res, next) => {
  try {
    const companyScope = scope(req, res);
    if (!companyScope) return;
    const name = String(req.body?.name || "").trim();
    if (!name) return fail(res, 400, "Leave type name is required");

    const leaveType = await LeaveType.create({
      name,
      nameKey: name.toLowerCase(),
      description: String(req.body?.description || "").trim(),
      sortOrder: Number(req.body?.sortOrder) || 1,
      status: req.body?.status || "Active",
      isCustom: true,
      ...companyScope,
      createdBy: req.user._id,
      updatedBy: req.user._id
    });
    await leaveType.populate([
      { path: "createdBy", select: "name email" },
      { path: "updatedBy", select: "name email" }
    ]);
    res.status(201).json({ success: true, leaveType });
  } catch (error) {
    if (error?.code === 11000) return fail(res, 409, "This leave type already exists");
    next(error);
  }
};

exports.deleteLeaveType = async (req, res, next) => {
  try {
    const companyScope = scope(req, res);
    if (!companyScope) return;
    if (!validId(req.params.id)) return fail(res, 400, "Invalid leave type id");
    const leaveType = await LeaveType.findOne({ _id: req.params.id, company: companyScope.company });
    if (!leaveType) return fail(res, 404, "Leave type not found");
    const isInUse = await LeavePolicy.exists({
      company: companyScope.company,
      leaveType: { $regex: new RegExp(`^${leaveType.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }
    });
    if (isInUse) return fail(res, 409, "This leave type is used by a policy. Delete or update that policy first.");
    await leaveType.deleteOne();
    res.json({ success: true, message: "Leave type deleted" });
  } catch (error) { next(error); }
};

const policyValues = (body) => ({
  policyName: String(body.policyName || "").trim(),
  department: body.department,
  jobRoles: Array.isArray(body.jobRoles) ? [...new Set(body.jobRoles.filter(validId).map(String))] : [],
  jobRoleNames: Array.isArray(body.jobRoleNames) ? body.jobRoleNames.map(String).map(v => v.trim()).filter(Boolean) : [],
  leaveType: String(body.leaveType || "").trim(),
  payType: body.payType || "Paid",
  entitledDays: Number(body.entitledDays) || 0,
  monthlyAllowed: Number(body.monthlyAllowed) || 0,
  carryForward: body.carryForward || "No",
  maxCarryForwardDays: Number(body.maxCarryForwardDays) || 0,
  encashmentAllowed: body.encashmentAllowed || "No",
  probationApplicable: body.probationApplicable || "No",
  sortOrder: Number(body.sortOrder) || 1,
  status: body.status || "Active"
});

const validatePolicyRelations = async (values, company) => {
  if (!values.policyName || !values.leaveType) return "Policy name and leave type are required";
  if (!["Paid", "Unpaid", "Admin Choice"].includes(values.payType)) return "Select a valid pay type";
  if (!validId(values.department)) return "A valid department is required";
  if (!values.jobRoles.length) return "At least one job role is required";
  const leaveType = await LeaveType.exists({
    company,
    nameKey: values.leaveType.toLowerCase(),
    status: "Active"
  });
  if (!leaveType) return "Select an active leave type configured for your company";
  const department = await Department.exists({ _id: values.department, company });
  if (!department) return "Department does not belong to your company";
  const roleCount = await JobRole.countDocuments({ _id: { $in: values.jobRoles }, company, department: values.department });
  if (roleCount !== values.jobRoles.length) return "One or more job roles do not belong to the selected department";
  return null;
};

exports.getLeavePolicies = async (req, res, next) => {
  try {
    const companyScope = scope(req, res);
    if (!companyScope) return;
    const leavePolicies = await LeavePolicy.find({ company: companyScope.company })
      .populate("department", "name branch company")
      .populate("jobRoles", "name department")
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email")
      .sort({ sortOrder: 1, createdAt: -1 }).lean();
    res.json({ success: true, leavePolicies });
  } catch (error) { next(error); }
};

exports.getApplicableLeavePolicies = async (req, res, next) => {
  try {
    const companyScope = scope(req, res);
    if (!companyScope) return;
    const user = await User.findById(req.user._id)
      .select("department jobRole employeeType dateOfJoining company")
      .lean();
    if (!user) return fail(res, 404, "User account not found");

    const [userDepartmentRecord, userJobRoleRecord] = await Promise.all([
      validId(user.department)
        ? Department.findOne({ _id: user.department, company: companyScope.company }).select("name").lean()
        : null,
      validId(user.jobRole)
        ? JobRole.findOne({ _id: user.jobRole, company: companyScope.company }).select("name roleName").lean()
        : null
    ]);

    const allPolicies = await LeavePolicy.find({ company: companyScope.company, status: "Active" })
      .populate("department", "name")
      .populate("jobRoles", "name")
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();
    const userDepartments = [normalize(user.department), normalize(userDepartmentRecord?.name)].filter(Boolean);
    const userRoles = [normalize(user.jobRole), normalize(userJobRoleRecord?.name || userJobRoleRecord?.roleName)].filter(Boolean);
    const isOnProbation = normalize(user.employeeType).includes("probation");

    const applicable = allPolicies.filter(policy => {
      const departments = [normalize(policy.department?._id || policy.department), normalize(policy.department?.name)].filter(Boolean);
      const roles = [
        ...(policy.jobRoles || []).flatMap(role => [normalize(role?._id || role), normalize(role?.name)]),
        ...(policy.jobRoleNames || []).map(normalize)
      ].filter(Boolean);
      return userDepartments.some(value => departments.includes(value)) &&
        userRoles.some(value => roles.includes(value)) &&
        (!isOnProbation || policy.probationApplicable === "Yes");
    });

    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const yearEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const previousStart = new Date(now.getFullYear() - 1, 0, 1);
    const previousEnd = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);

    const policies = await Promise.all(applicable.map(async policy => {
      const typeMatcher = { $regex: new RegExp(`^${String(policy.leaveType).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") };
      const [currentLeaves, previousLeaves] = await Promise.all([
        Leave.find({
          user: user._id,
          type: typeMatcher,
          status: { $in: ["Pending", "Approved"] },
          startDate: { $lte: yearEnd },
          endDate: { $gte: yearStart }
        }).select("startDate endDate status").lean(),
        policy.carryForward === "Yes"
          ? Leave.find({
              user: user._id,
              type: typeMatcher,
              status: "Approved",
              startDate: { $lte: previousEnd },
              endDate: { $gte: previousStart }
            }).select("startDate endDate").lean()
          : []
      ]);
      const approvedLeaves = currentLeaves.filter(leave => leave.status === "Approved");
      const pendingLeaves = currentLeaves.filter(leave => leave.status === "Pending");
      const used = approvedLeaves.reduce((sum, leave) => sum + overlapDays(leave.startDate, leave.endDate, yearStart, yearEnd), 0);
      const pending = pendingLeaves.reduce((sum, leave) => sum + overlapDays(leave.startDate, leave.endDate, yearStart, yearEnd), 0);
      const usedThisMonth = approvedLeaves.reduce((sum, leave) => sum + overlapDays(leave.startDate, leave.endDate, monthStart, monthEnd), 0);
      const pendingThisMonth = pendingLeaves.reduce((sum, leave) => sum + overlapDays(leave.startDate, leave.endDate, monthStart, monthEnd), 0);
      const previousUsed = previousLeaves.reduce((sum, leave) => sum + overlapDays(leave.startDate, leave.endDate, previousStart, previousEnd), 0);
      const carryForwardDays = policy.carryForward === "Yes"
        ? Math.min(Math.max(Number(policy.entitledDays) - previousUsed, 0), Number(policy.maxCarryForwardDays) || 0)
        : 0;
      const allocated = Number(policy.entitledDays) + carryForwardDays;

      return {
        ...policy,
        balance: {
          allocated,
          baseEntitlement: Number(policy.entitledDays),
          carryForwardDays,
          used,
          pending,
          remaining: Math.max(allocated - used - pending, 0),
          monthlyLimit: Number(policy.monthlyAllowed),
          usedThisMonth,
          pendingThisMonth,
          remainingThisMonth: Math.max(Number(policy.monthlyAllowed) - usedThisMonth - pendingThisMonth, 0)
        }
      };
    }));

    res.json({
      success: true,
      policies,
      hasConfiguredPolicies: allPolicies.length > 0,
      user: {
        isOnProbation,
        department: { value: user.department, name: userDepartmentRecord?.name || (!validId(user.department) ? user.department : "") },
        jobRole: { value: user.jobRole, name: userJobRoleRecord?.name || userJobRoleRecord?.roleName || (!validId(user.jobRole) ? user.jobRole : "") }
      }
    });
  } catch (error) { next(error); }
};

exports.createLeavePolicy = async (req, res, next) => {
  try {
    const companyScope = scope(req, res);
    if (!companyScope) return;
    const values = policyValues(req.body || {});
    const validationError = await validatePolicyRelations(values, companyScope.company);
    if (validationError) return fail(res, 400, validationError);
    const leavePolicy = await LeavePolicy.create({ ...values, ...companyScope, createdBy: req.user._id, updatedBy: req.user._id });
    await leavePolicy.populate([
      { path: "department", select: "name branch" },
      { path: "jobRoles", select: "name department" },
      { path: "createdBy", select: "name email" },
      { path: "updatedBy", select: "name email" }
    ]);
    res.status(201).json({ success: true, leavePolicy });
  } catch (error) { next(error); }
};

exports.updateLeavePolicy = async (req, res, next) => {
  try {
    const companyScope = scope(req, res);
    if (!companyScope) return;
    if (!validId(req.params.id)) return fail(res, 400, "Invalid leave policy id");
    const values = policyValues(req.body || {});
    const validationError = await validatePolicyRelations(values, companyScope.company);
    if (validationError) return fail(res, 400, validationError);
    const leavePolicy = await LeavePolicy.findOneAndUpdate(
      { _id: req.params.id, company: companyScope.company },
      { ...values, updatedBy: req.user._id },
      { new: true, runValidators: true }
    )
      .populate("department", "name branch")
      .populate("jobRoles", "name department")
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email");
    if (!leavePolicy) return fail(res, 404, "Leave policy not found");
    res.json({ success: true, leavePolicy });
  } catch (error) { next(error); }
};

exports.deleteLeavePolicy = async (req, res, next) => {
  try {
    const companyScope = scope(req, res);
    if (!companyScope) return;
    if (!validId(req.params.id)) return fail(res, 400, "Invalid leave policy id");
    const deleted = await LeavePolicy.findOneAndDelete({ _id: req.params.id, company: companyScope.company });
    if (!deleted) return fail(res, 404, "Leave policy not found");
    res.json({ success: true, message: "Leave policy deleted" });
  } catch (error) { next(error); }
};

exports.requireLeavePolicyEdit = requireLeavePolicyPermission("edit");
exports.requireLeavePolicyDelete = requireLeavePolicyPermission("delete");
