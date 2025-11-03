const User = require("../models/User");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const sendEmail = require("../utils/sendEmail");

// Reusable error response
const errorResponse = (res, status, message) => {
  return res.status(status).json({ success: false, message });
};

// ✅ Register User
exports.register = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      role,
      phone,
      address,
      gender,
      maritalStatus,
      dob,
      salary,
      accountNumber,
      ifsc,
      bankName,
      bankHolderName,
      employeeType,
      jobRole,
      properties = [],
      propertyOwned,
      additionalDetails,
      fatherName,
      motherName,
      emergencyName,
      emergencyPhone,
      emergencyRelation,
      emergencyAddress,
    } = req.body;

    const cleanEmail = email?.trim().toLowerCase();

    if (!name || !cleanEmail || !password) {
      return errorResponse(res, 400, "Name, email, and password are required");
    }

    // ✅ Email format validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return errorResponse(res, 400, "Invalid email format");
    }

    // ✅ Check existing user
    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      return errorResponse(res, 409, "Email already in use");
    }

    // ✅ Role validation
    const validRoles = ["admin", "user", "hr", "manager"];
    const assignedRole = validRoles.includes(role) ? role : "user";

    // ✅ Create user data
    const userData = {
      name,
      email: cleanEmail,
      password,
      role: assignedRole,
      employeeType,
    };

    // ✅ For user role, include optional details if provided
    if (assignedRole === "user") {
      Object.assign(userData, {
        ...(phone && { phone }),
        ...(address && { address }),
        ...(gender && { gender }),
        ...(maritalStatus && { maritalStatus }),
        ...(dob && { dob }),
        ...(salary && { salary }),
        ...(accountNumber && { accountNumber }),
        ...(ifsc && { ifsc }),
        ...(bankName && { bankName }),
        ...(bankHolderName && { bankHolderName }),
        ...(employeeType && { employeeType }),
        ...(jobRole && { jobRole }),
        ...(properties?.length && { properties }),
        ...(propertyOwned && { propertyOwned }),
        ...(additionalDetails && { additionalDetails }),
        ...(fatherName && { fatherName }),
        ...(motherName && { motherName }),
        ...(emergencyName && { emergencyName }),
        ...(emergencyPhone && { emergencyPhone }),
        ...(emergencyRelation && { emergencyRelation }),
        ...(emergencyAddress && { emergencyAddress }),
      });
    }

    // ✅ Create new user
    const user = await User.create(userData);

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    console.error("❌ Registration error:", err);
    return errorResponse(res, 500, "Registration failed");
  }
};


// ✅ Login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const cleanEmail = email?.trim().toLowerCase();

    if (!cleanEmail || !password) {
      return errorResponse(res, 400, "Email and password are required");
    }

    const user = await User.findOne({ email: cleanEmail }).select("+password");
    if (!user) {
      return errorResponse(res, 401, "Invalid credentials");
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return errorResponse(res, 401, "Invalid credentials");
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "12h" } // 12 hours session
    );

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        address: user.address,
        gender: user.gender,
        maritalStatus: user.maritalStatus,
        dob: user.dob,
        salary: user.salary,
        accountNumber: user.accountNumber,
        ifsc: user.ifsc,
        bankName: user.bankName,
        bankHolderName: user.bankHolderName,
        employeeType: user.employeeType,
        jobRole: user.jobRole,
        properties: user.properties,
        propertyOwned: user.propertyOwned,
        additionalDetails: user.additionalDetails,
        fatherName: user.fatherName,
        motherName: user.motherName,
        emergencyName: user.emergencyName,
        emergencyPhone: user.emergencyPhone,
        emergencyRelation: user.emergencyRelation,
        emergencyAddress: user.emergencyAddress,
        createdAt: user.createdAt
      },
    });
  } catch (err) {
    console.error("❌ Login error:", err);
    return errorResponse(res, 500, "Server error during login");
  }
};

// ✅ Forgot Password
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const cleanEmail = email?.trim().toLowerCase();

    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return errorResponse(res, 400, "Please provide a valid email address");
    }

    const user = await User.findOne({ email: cleanEmail });
    const resetLink = user
      ? `${process.env.FRONTEND_URL}/reset-password?id=${user._id}`
      : null;

    if (user && resetLink) {
      await sendEmail(
        cleanEmail,
        "🔐 Password Reset Request",
        `
          <p>You requested a password reset.</p>
          <p><a href="${resetLink}" style="background-color: #4CAF50; color: white; padding: 10px 15px; text-decoration: none;">Reset Password</a></p>
          <p>If you didn’t request this, you can ignore this email.</p>
        `
      );
    }

    return res.status(200).json({
      success: true,
      message: "If an account exists with this email, a reset link has been sent",
    });
  } catch (err) {
    console.error("❌ Forgot password error:", err);
    return errorResponse(res, 500, "Server error during password reset request");
  }
};

// ✅ Reset Password
exports.resetPassword = async (req, res) => {
  try {
    const { id, password } = req.body;

    if (!id || !password) {
      return errorResponse(res, 400, "User ID and new password are required");
    }

    if (password.length < 5) {
      return errorResponse(res, 400, "Password must be at least 5 characters");
    }

    const user = await User.findById(id);
    if (!user) {
      return errorResponse(res, 404, "User not found");
    }

    user.password = await bcrypt.hash(password, 10);
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password has been reset successfully",
    });
  } catch (err) {
    console.error("❌ Reset password error:", err);
    return errorResponse(res, 500, "Server error during password reset");
  }
};

// ✅ Change Password (email + old password)
exports.changePassword = async (req, res) => {
  try {
    const { email, oldPassword, newPassword } = req.body;

    if (!email || !oldPassword || !newPassword) {
      return errorResponse(res, 400, "All fields are required");
    }

    if (newPassword.length < 5) {
      return errorResponse(res, 400, "New password must be at least 5 characters");
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
    if (!user) {
      return errorResponse(res, 404, "User not found");
    }

    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) {
      return errorResponse(res, 400, "Old password is incorrect");
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (err) {
    console.error("❌ Change password error:", err);
    return errorResponse(res, 500, "Server error during password change");
  }
};
