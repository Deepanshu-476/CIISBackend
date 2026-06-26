const Holiday = require("../models/Holiday");
const User = require("../../models/User");

// Error response helper.
const errorResponse = (res, status, message) => {
    return res.status(status).json({ success: false, message });
};

// Check whether the user is a super admin.
const isSuperAdmin = (user) => {
    if (!user) return false;
    
    // Super-admin conditions:
    // 1. role = 'super-admin'
    // 2. department = 'Management'
    // 3. jobRole = 'super_admin'
    const isSuper = user.role === 'super-admin' && 
                   user.department === 'Management' && 
                   user.jobRole === 'super_admin';
    
    console.log('🔄 Super admin check:', {
        userId: user._id || user.id,
        name: user.name,
        role: user.role,
        department: user.department,
        jobRole: user.jobRole,
        isSuper: isSuper
    });
    
    return isSuper;
};

// ==================== 1. ADD HOLIDAY ====================
exports.addHoliday = async (req, res) => {
    try {
        console.log("========================================");
        console.log("🚀 HOLIDAY ADD REQUEST RECEIVED");
        console.log("========================================");
        
        const { title, date, month, description } = req.body;
        const createdBy = req.user ? req.user.id : null;

        // Authentication check
        if (!createdBy) {
            return errorResponse(res, 401, "Please log in first");
        }

        // Required fields check
        if (!title || !date || !month) {
            return errorResponse(res, 400, "Title, date, and month are required");
        }

        // Fetch user from the database.
        const user = await User.findById(createdBy);
        if (!user) {
            return errorResponse(res, 400, "User not found");
        }

        // Company check
        if (!user.company) {
            return errorResponse(res, 400, "User company not found");
        }

        // Super-admin check
        const isSuper = isSuperAdmin(user);
        
        // Decide which company the holiday belongs to.
        let companyId, companyCode;
        
        if (isSuper) {
            // Super admin can specify their own company or another company.
            companyId = req.body.company || user.company;
            companyCode = req.body.companyCode || user.companyCode;
        } else {
            // Normal users can create holidays only for their own company.
            companyId = user.company;
            companyCode = user.companyCode;
        }

        // Duplicate check.
        const existingHoliday = await Holiday.findOne({ 
            title: { $regex: new RegExp(`^${title}$`, 'i') },
            date: date,
            company: companyId,
            isActive: true
        });
        
        if (existingHoliday) {
            return errorResponse(res, 409, "This holiday already exists for the company");
        }

        // Create holiday.
        const holiday = await Holiday.create({
            title,
            date,
            month,
            description,
            company: companyId,
            companyCode,
            createdBy
        });

        return res.status(201).json({
            success: true,
            message: "Holiday added successfully",
            holiday
        });
    } catch (error) {
        console.error("❌ ERROR:", error.message);
        
        if (error.code === 11000) {
            return errorResponse(res, 409, "Duplicate holiday - this already exists");
        }
        
        return errorResponse(res, 500, "Failed to add holiday");
    }
};

// ==================== 2. GET HOLIDAYS ====================
exports.getHolidays = async (req, res) => {
    try {
        console.log("========================================");
        console.log("📋 GET HOLIDAYS REQUEST");
        console.log("========================================");
        
        const { month, company } = req.query;
        
        if (!req.user) {
            return errorResponse(res, 401, "Please log in first");
        }

        // Fetch user.
        const user = await User.findById(req.user.id);
        if (!user) {
            return errorResponse(res, 400, "User not found");
        }

        const isSuper = isSuperAdmin(user);
        
        // Build query.
        let query = { isActive: true };
        
        // Normal users can see only their own company's holidays.
        if (!isSuper) {
            if (!user.company) {
                return errorResponse(res, 400, "User company not found");
            }
            query.company = user.company;
        } else if (company) {
            // Super admin can view holidays for a specific company.
            query.company = company;
        }
        
        // Apply month filter when provided.
        if (month) {
            query.month = month;
        }
        
        // Fetch holidays.
        const holidays = await Holiday.find(query)
            .populate('createdBy', 'name email')
            .sort({ date: 1 });  // Sort by date.

        return res.status(200).json({
            success: true,
            count: holidays.length,
            holidays
        });
    } catch (error) {
        console.error("❌ ERROR:", error.message);
        return errorResponse(res, 500, "Failed to fetch holidays");
    }
};

// ==================== 3. GET HOLIDAYS BY COMPANY ====================
exports.getHolidaysByCompany = async (req, res) => {
    try {
        console.log("========================================");
        console.log("🏢 GET HOLIDAYS BY COMPANY");
        console.log("========================================");
        
        const { companyId } = req.params;
        const { month } = req.query;
        
        if (!req.user) {
            return errorResponse(res, 401, "Please log in first");
        }

        const user = await User.findById(req.user.id);
        if (!user) {
            return errorResponse(res, 400, "User not found");
        }

        const isSuper = isSuperAdmin(user);
        
        // Prepare query.
        let query = { 
            isActive: true,
            company: companyId 
        };
        
        if (month) {
            query.month = month;
        }
        
        // Permission check: normal users can view only their own company.
        if (!isSuper) {
            if (!user.company) {
                return errorResponse(res, 400, "User company not found");
            }
            
            if (user.company.toString() !== companyId) {
                return errorResponse(res, 403, "You cannot view this company");
            }
        }
        
        const holidays = await Holiday.find(query)
            .select('title date month description')
            .sort({ date: 1 });

        return res.status(200).json({
            success: true,
            count: holidays.length,
            holidays
        });
    } catch (error) {
        console.error("❌ ERROR:", error.message);
        return errorResponse(res, 500, "Failed to fetch holidays");
    }
};

// ==================== 4. UPDATE HOLIDAY ====================
exports.updateHoliday = async (req, res) => {
    try {
        console.log("========================================");
        console.log("✏️ HOLIDAY UPDATE REQUEST");
        console.log("========================================");
        
        const { id } = req.params;
        const updateData = req.body;
        
        if (!req.user) {
            return errorResponse(res, 401, "Please log in first");
        }

        // Fetch user.
        const user = await User.findById(req.user.id);
        if (!user) {
            return errorResponse(res, 400, "User not found");
        }

        const isSuper = isSuperAdmin(user);

        // Fetch the holiday to update.
        const holiday = await Holiday.findById(id);
        if (!holiday) {
            return errorResponse(res, 404, "Holiday not found");
        }

        // Permission check: normal users can update only their own company.
        if (!isSuper) {
            if (!user.company) {
                return errorResponse(res, 400, "User company not found");
            }
            
            if (holiday.company.toString() !== user.company.toString()) {
                return errorResponse(res, 403, "You cannot update this holiday");
            }
        }

        // Duplicate check when title or date changes.
        if ((updateData.title && updateData.title !== holiday.title) || 
            (updateData.date && updateData.date !== holiday.date)) {
            
            const title = updateData.title || holiday.title;
            const date = updateData.date || holiday.date;
            
            const existingHoliday = await Holiday.findOne({ 
                title: { $regex: new RegExp(`^${title}$`, 'i') },
                date: date,
                company: holiday.company,
                _id: { $ne: id },
                isActive: true
            });
            
            if (existingHoliday) {
                return errorResponse(res, 409, "This holiday already exists");
            }
        }

        // Normal users cannot change the company.
        if (!isSuper) {
            delete updateData.company;
            delete updateData.companyCode;
        }

        // Update holiday.
        const updatedHoliday = await Holiday.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        ).populate('createdBy', 'name email');

        return res.status(200).json({
            success: true,
            message: "Holiday updated successfully",
            holiday: updatedHoliday
        });
    } catch (error) {
        console.error("❌ ERROR:", error.message);
        
        if (error.code === 11000) {
            return errorResponse(res, 409, "Duplicate holiday - this already exists");
        }
        
        return errorResponse(res, 500, "Failed to update holiday");
    }
};

// ==================== 5. DELETE HOLIDAY (SOFT DELETE) ====================
exports.deleteHoliday = async (req, res) => {
    try {
        console.log("========================================");
        console.log("🗑️ HOLIDAY DELETE REQUEST");
        console.log("========================================");
        
        const { id } = req.params;
        
        if (!req.user) {
            return errorResponse(res, 401, "Please log in first");
        }

        // Fetch user.
        const user = await User.findById(req.user.id);
        if (!user) {
            return errorResponse(res, 400, "User not found");
        }

        const isSuper = isSuperAdmin(user);

        // Fetch holiday.
        const holiday = await Holiday.findById(id);
        if (!holiday) {
            return errorResponse(res, 404, "Holiday not found");
        }

        // Permission check
        if (!isSuper) {
            if (!user.company) {
                return errorResponse(res, 400, "User company not found");
            }
            
            if (holiday.company.toString() !== user.company.toString()) {
                return errorResponse(res, 403, "You cannot delete this holiday");
            }
        }

        // Soft delete by marking isActive false.
        holiday.isActive = false;
        await holiday.save();

        return res.status(200).json({
            success: true,
            message: "Holiday deleted successfully"
        });
    } catch (error) {
        console.error("❌ ERROR:", error.message);
        return errorResponse(res, 500, "Failed to delete holiday");
    }
};

// ==================== 6. HARD DELETE (SUPER ADMIN ONLY) ====================
exports.hardDeleteHoliday = async (req, res) => {
    try {
        console.log("========================================");
        console.log("🔥 PERMANENT DELETE REQUEST (HARD DELETE)");
        console.log("========================================");
        
        const { id } = req.params;
        
        if (!req.user) {
            return errorResponse(res, 401, "Please log in first");
        }

        const user = await User.findById(req.user.id);
        if (!user) {
            return errorResponse(res, 400, "User not found");
        }

        const isSuper = isSuperAdmin(user);
        
        // Only super admins can hard delete.
        if (!isSuper) {
            return errorResponse(res, 403, "Only a super admin can permanently delete holidays");
        }

        // Permanently delete.
        const holiday = await Holiday.findByIdAndDelete(id);

        if (!holiday) {
            return errorResponse(res, 404, "Holiday not found");
        }

        return res.status(200).json({
            success: true,
            message: "Holiday permanently deleted"
        });
    } catch (error) {
        console.error("❌ ERROR:", error.message);
        return errorResponse(res, 500, "Failed to permanently delete holiday");
    }
};

console.log("✅ HolidayController.js loaded successfully");
