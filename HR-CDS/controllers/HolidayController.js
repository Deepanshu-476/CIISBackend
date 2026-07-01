const Holiday = require("../models/Holiday");
const User = require("../../models/User");


const errorResponse = (res, status, message) => {
    return res.status(status).json({ success: false, message });
};


const isSuperAdmin = (user) => {
    if (!user) return false;
    
    
    
    
    
    const isSuper = user.role === 'super-admin' && 
                   user.department === 'Management' && 
                   user.jobRole === 'super_admin';
    
    void 0;
    
    return isSuper;
};


exports.addHoliday = async (req, res) => {
    try {
        void 0;
        void 0;
        void 0;
        
        const { title, date, month, description } = req.body;
        const createdBy = req.user ? req.user.id : null;

        
        if (!createdBy) {
            return errorResponse(res, 401, "Please log in first");
        }

        
        if (!title || !date || !month) {
            return errorResponse(res, 400, "Title, date, and month are required");
        }

        
        const user = await User.findById(createdBy);
        if (!user) {
            return errorResponse(res, 400, "User not found");
        }

        
        if (!user.company) {
            return errorResponse(res, 400, "User company not found");
        }

        
        const isSuper = isSuperAdmin(user);
        
        
        let companyId, companyCode;
        
        if (isSuper) {
            
            companyId = req.body.company || user.company;
            companyCode = req.body.companyCode || user.companyCode;
        } else {
            
            companyId = user.company;
            companyCode = user.companyCode;
        }

        
        const existingHoliday = await Holiday.findOne({ 
            title: { $regex: new RegExp(`^${title}$`, 'i') },
            date: date,
            company: companyId,
            isActive: true
        });
        
        if (existingHoliday) {
            return errorResponse(res, 409, "This holiday already exists for the company");
        }

        
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


exports.getHolidays = async (req, res) => {
    try {
        void 0;
        void 0;
        void 0;
        
        const { month, company } = req.query;
        
        if (!req.user) {
            return errorResponse(res, 401, "Please log in first");
        }

        
        const user = await User.findById(req.user.id);
        if (!user) {
            return errorResponse(res, 400, "User not found");
        }

        const isSuper = isSuperAdmin(user);
        
        
        let query = { isActive: true };
        
        
        if (!isSuper) {
            if (!user.company) {
                return errorResponse(res, 400, "User company not found");
            }
            query.company = user.company;
        } else if (company) {
            
            query.company = company;
        }
        
        
        if (month) {
            query.month = month;
        }
        
        
        const holidays = await Holiday.find(query)
            .populate('createdBy', 'name email')
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


exports.getHolidaysByCompany = async (req, res) => {
    try {
        void 0;
        void 0;
        void 0;
        
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
        
        
        let query = { 
            isActive: true,
            company: companyId 
        };
        
        if (month) {
            query.month = month;
        }
        
        
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


exports.updateHoliday = async (req, res) => {
    try {
        void 0;
        void 0;
        void 0;
        
        const { id } = req.params;
        const updateData = req.body;
        
        if (!req.user) {
            return errorResponse(res, 401, "Please log in first");
        }

        
        const user = await User.findById(req.user.id);
        if (!user) {
            return errorResponse(res, 400, "User not found");
        }

        const isSuper = isSuperAdmin(user);

        
        const holiday = await Holiday.findById(id);
        if (!holiday) {
            return errorResponse(res, 404, "Holiday not found");
        }

        
        if (!isSuper) {
            if (!user.company) {
                return errorResponse(res, 400, "User company not found");
            }
            
            if (holiday.company.toString() !== user.company.toString()) {
                return errorResponse(res, 403, "You cannot update this holiday");
            }
        }

        
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

        
        if (!isSuper) {
            delete updateData.company;
            delete updateData.companyCode;
        }

        
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


exports.deleteHoliday = async (req, res) => {
    try {
        void 0;
        void 0;
        void 0;
        
        const { id } = req.params;
        
        if (!req.user) {
            return errorResponse(res, 401, "Please log in first");
        }

        
        const user = await User.findById(req.user.id);
        if (!user) {
            return errorResponse(res, 400, "User not found");
        }

        const isSuper = isSuperAdmin(user);

        
        const holiday = await Holiday.findById(id);
        if (!holiday) {
            return errorResponse(res, 404, "Holiday not found");
        }

        
        if (!isSuper) {
            if (!user.company) {
                return errorResponse(res, 400, "User company not found");
            }
            
            if (holiday.company.toString() !== user.company.toString()) {
                return errorResponse(res, 403, "You cannot delete this holiday");
            }
        }

        
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


exports.hardDeleteHoliday = async (req, res) => {
    try {
        void 0;
        void 0;
        void 0;
        
        const { id } = req.params;
        
        if (!req.user) {
            return errorResponse(res, 401, "Please log in first");
        }

        const user = await User.findById(req.user.id);
        if (!user) {
            return errorResponse(res, 400, "User not found");
        }

        const isSuper = isSuperAdmin(user);
        
        
        if (!isSuper) {
            return errorResponse(res, 403, "Only a super admin can permanently delete holidays");
        }

        
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

void 0;
