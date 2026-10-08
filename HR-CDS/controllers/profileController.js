const User = require('../../models/User');
const Department = require('../../models/Department');
const JobRole = require('../../models/JobRole');
const mongoose = require('mongoose');

exports.getUserProfile = async (req, res) => {
  try {
    const requestedUserId = req.params.id;
    const loggedInUser = req.user;

    if (requestedUserId !== loggedInUser._id.toString() && loggedInUser.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized access' });
    }

    const user = await User.findById(requestedUserId)
      .select('-password -resetToken -resetTokenExpiry')
      .populate('company', 'companyName name companyCode')
      .populate('branch', 'name branchName branchCode');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const userObj = user.toObject();

    // Resolve Department
    let deptName = userObj.departmentName || '';
    const rawDept = userObj.department;
    if (rawDept && mongoose.Types.ObjectId.isValid(String(rawDept))) {
      try {
        const deptDoc = await Department.findById(rawDept).select('name description code').lean();
        if (deptDoc) {
          deptName = deptDoc.name || deptName;
          userObj.department = { _id: deptDoc._id, name: deptDoc.name, code: deptDoc.code };
          userObj.departmentName = deptName;
          if (!user.departmentName) {
            User.updateOne({ _id: user._id }, { departmentName: deptName }).catch(() => {});
          }
        }
      } catch (deptErr) {
        console.warn('Could not populate department in profile:', deptErr.message);
      }
    } else if (typeof rawDept === 'string' && !deptName) {
      deptName = rawDept;
      userObj.departmentName = deptName;
    }

    // Resolve JobRole / Designation
    let roleName = userObj.jobRoleName || '';
    const rawJobRole = userObj.jobRole;
    if (rawJobRole && mongoose.Types.ObjectId.isValid(String(rawJobRole))) {
      try {
        const roleDoc = await JobRole.findById(rawJobRole).select('name roleName roleNumber description').lean();
        if (roleDoc) {
          roleName = roleDoc.name || roleDoc.roleName || roleName;
          userObj.jobRole = {
            _id: roleDoc._id,
            name: roleDoc.name,
            roleName: roleDoc.roleName || roleDoc.name,
            roleNumber: roleDoc.roleNumber,
          };
          userObj.jobRoleName = roleName;
          if (!user.jobRoleName) {
            User.updateOne({ _id: user._id }, { jobRoleName: roleName }).catch(() => {});
          }
        }
      } catch (roleErr) {
        console.warn('Could not populate jobRole in profile:', roleErr.message);
      }
    } else if (typeof rawJobRole === 'string' && !roleName) {
      roleName = rawJobRole;
      userObj.jobRoleName = roleName;
    }

    // Ensure branchName is populated
    if (!userObj.branchName && userObj.branch?.name) {
      userObj.branchName = userObj.branch.name;
    }

    res.status(200).json(userObj);
  } catch (err) {
    console.error('❌ Error fetching user profile:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
