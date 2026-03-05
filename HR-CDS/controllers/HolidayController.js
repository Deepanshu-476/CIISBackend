const Holiday = require("../models/Holiday");
const User = require("../../models/User");

// Error response ka helper function
const errorResponse = (res, status, message) => {
    return res.status(status).json({ success: false, message });
};

// Check karta hai ki user super-admin hai ya nahi
const isSuperAdmin = (user) => {
    if (!user) return false;
    
    // Super-admin ke teen conditions:
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

// ==================== 1. HOLIDAY ADD KARNA ====================
exports.addHoliday = async (req, res) => {
    try {
        console.log("========================================");
        console.log("🚀 HOLIDAY ADD KARNE KA REQUEST AAYA");
        console.log("========================================");
        
        const { title, date, month, description } = req.body;
        const createdBy = req.user ? req.user.id : null;

        // Authentication check
        if (!createdBy) {
            return errorResponse(res, 401, "Pehle login karo");
        }

        // Required fields check
        if (!title || !date || !month) {
            return errorResponse(res, 400, "Title, date aur month dena zaroori hai");
        }

        // User ko DB se fetch karo
        const user = await User.findById(createdBy);
        if (!user) {
            return errorResponse(res, 400, "User nahi mila");
        }

        // Company check
        if (!user.company) {
            return errorResponse(res, 400, "User ki company nahi mili");
        }

        // Super-admin check
        const isSuper = isSuperAdmin(user);
        
        // Decide karo ki kis company ke liye holiday banega
        let companyId, companyCode;
        
        if (isSuper) {
            // Super admin: khud ki company ya koi aur company specify kar sakta hai
            companyId = req.body.company || user.company;
            companyCode = req.body.companyCode || user.companyCode;
        } else {
            // Normal user: sirf apni company ke liye bana sakta hai
            companyId = user.company;
            companyCode = user.companyCode;
        }

        // Duplicate check - kya ye holiday already exists?
        const existingHoliday = await Holiday.findOne({ 
            title: { $regex: new RegExp(`^${title}$`, 'i') },
            date: date,
            company: companyId,
            isActive: true
        });
        
        if (existingHoliday) {
            return errorResponse(res, 409, "Is company me ye holiday already exists");
        }

        // Holiday create karo
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
            message: "Holiday successfully add ho gaya",
            holiday
        });
    } catch (error) {
        console.error("❌ ERROR:", error.message);
        
        if (error.code === 11000) {
            return errorResponse(res, 409, "Duplicate holiday - ye already exists");
        }
        
        return errorResponse(res, 500, "Holiday add karne me problem hui");
    }
};

// ==================== 2. SARI HOLIDAYS DIKHAO ====================
exports.getHolidays = async (req, res) => {
    try {
        console.log("========================================");
        console.log("📋 SARI HOLIDAYS DIKHANE KA REQUEST");
        console.log("========================================");
        
        const { month, company } = req.query;
        
        if (!req.user) {
            return errorResponse(res, 401, "Pehle login karo");
        }

        // User fetch karo
        const user = await User.findById(req.user.id);
        if (!user) {
            return errorResponse(res, 400, "User nahi mila");
        }

        const isSuper = isSuperAdmin(user);
        
        // Query build karo
        let query = { isActive: true };
        
        // Agar normal user hai to sirf apni company ki holidays dikhao
        if (!isSuper) {
            if (!user.company) {
                return errorResponse(res, 400, "User ki company nahi mili");
            }
            query.company = user.company;
        } else if (company) {
            // Super admin: kisi specific company ki holidays dekh sakta hai
            query.company = company;
        }
        
        // Month filter agar diya ho to
        if (month) {
            query.month = month;
        }
        
        // Holidays fetch karo
        const holidays = await Holiday.find(query)
            .populate('createdBy', 'name email')
            .sort({ date: 1 });  // Date ke hisaab se sort

        return res.status(200).json({
            success: true,
            count: holidays.length,
            holidays
        });
    } catch (error) {
        console.error("❌ ERROR:", error.message);
        return errorResponse(res, 500, "Holidays fetch karne me problem hui");
    }
};

// ==================== 3. COMPANY KE HISAB SE HOLIDAYS ====================
exports.getHolidaysByCompany = async (req, res) => {
    try {
        console.log("========================================");
        console.log("🏢 COMPANY KE HISAB SE HOLIDAYS");
        console.log("========================================");
        
        const { companyId } = req.params;
        const { month } = req.query;
        
        if (!req.user) {
            return errorResponse(res, 401, "Pehle login karo");
        }

        const user = await User.findById(req.user.id);
        if (!user) {
            return errorResponse(res, 400, "User nahi mila");
        }

        const isSuper = isSuperAdmin(user);
        
        // Query prepare karo
        let query = { 
            isActive: true,
            company: companyId 
        };
        
        if (month) {
            query.month = month;
        }
        
        // Permission check - normal user apni hi company dekh sakta hai
        if (!isSuper) {
            if (!user.company) {
                return errorResponse(res, 400, "User ki company nahi mili");
            }
            
            if (user.company.toString() !== companyId) {
                return errorResponse(res, 403, "Tum ye company nahi dekh sakte");
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
        return errorResponse(res, 500, "Holidays fetch karne me problem hui");
    }
};

// ==================== 4. HOLIDAY UPDATE KARO ====================
exports.updateHoliday = async (req, res) => {
    try {
        console.log("========================================");
        console.log("✏️ HOLIDAY UPDATE KARNE KA REQUEST");
        console.log("========================================");
        
        const { id } = req.params;
        const updateData = req.body;
        
        if (!req.user) {
            return errorResponse(res, 401, "Pehle login karo");
        }

        // User fetch karo
        const user = await User.findById(req.user.id);
        if (!user) {
            return errorResponse(res, 400, "User nahi mila");
        }

        const isSuper = isSuperAdmin(user);

        // Holiday fetch karo jo update karna hai
        const holiday = await Holiday.findById(id);
        if (!holiday) {
            return errorResponse(res, 404, "Holiday nahi mila");
        }

        // Permission check - normal user apni company ka hi update kar sakta hai
        if (!isSuper) {
            if (!user.company) {
                return errorResponse(res, 400, "User ki company nahi mili");
            }
            
            if (holiday.company.toString() !== user.company.toString()) {
                return errorResponse(res, 403, "Tum ye holiday update nahi kar sakte");
            }
        }

        // Duplicate check - agar title ya date change ho raha hai
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
                return errorResponse(res, 409, "Ye holiday already exists");
            }
        }

        // Normal user company change nahi kar sakta
        if (!isSuper) {
            delete updateData.company;
            delete updateData.companyCode;
        }

        // Update karo
        const updatedHoliday = await Holiday.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        ).populate('createdBy', 'name email');

        return res.status(200).json({
            success: true,
            message: "Holiday successfully update ho gaya",
            holiday: updatedHoliday
        });
    } catch (error) {
        console.error("❌ ERROR:", error.message);
        
        if (error.code === 11000) {
            return errorResponse(res, 409, "Duplicate holiday - ye already exists");
        }
        
        return errorResponse(res, 500, "Holiday update karne me problem hui");
    }
};

// ==================== 5. HOLIDAY DELETE KARO (SOFT DELETE) ====================
exports.deleteHoliday = async (req, res) => {
    try {
        console.log("========================================");
        console.log("🗑️ HOLIDAY DELETE KARNE KA REQUEST");
        console.log("========================================");
        
        const { id } = req.params;
        
        if (!req.user) {
            return errorResponse(res, 401, "Pehle login karo");
        }

        // User fetch karo
        const user = await User.findById(req.user.id);
        if (!user) {
            return errorResponse(res, 400, "User nahi mila");
        }

        const isSuper = isSuperAdmin(user);

        // Holiday fetch karo
        const holiday = await Holiday.findById(id);
        if (!holiday) {
            return errorResponse(res, 404, "Holiday nahi mila");
        }

        // Permission check
        if (!isSuper) {
            if (!user.company) {
                return errorResponse(res, 400, "User ki company nahi mili");
            }
            
            if (holiday.company.toString() !== user.company.toString()) {
                return errorResponse(res, 403, "Tum ye holiday delete nahi kar sakte");
            }
        }

        // Soft delete - sirf isActive false karo
        holiday.isActive = false;
        await holiday.save();

        return res.status(200).json({
            success: true,
            message: "Holiday successfully delete ho gaya"
        });
    } catch (error) {
        console.error("❌ ERROR:", error.message);
        return errorResponse(res, 500, "Holiday delete karne me problem hui");
    }
};

// ==================== 6. HARD DELETE (SIRF SUPER-ADMIN) ====================
exports.hardDeleteHoliday = async (req, res) => {
    try {
        console.log("========================================");
        console.log("🔥 PERMANENT DELETE REQUEST (HARD DELETE)");
        console.log("========================================");
        
        const { id } = req.params;
        
        if (!req.user) {
            return errorResponse(res, 401, "Pehle login karo");
        }

        const user = await User.findById(req.user.id);
        if (!user) {
            return errorResponse(res, 400, "User nahi mila");
        }

        const isSuper = isSuperAdmin(user);
        
        // Sirf super-admin hi hard delete kar sakta hai
        if (!isSuper) {
            return errorResponse(res, 403, "Sirf super-admin permanent delete kar sakta hai");
        }

        // Permanently delete karo
        const holiday = await Holiday.findByIdAndDelete(id);

        if (!holiday) {
            return errorResponse(res, 404, "Holiday nahi mila");
        }

        return res.status(200).json({
            success: true,
            message: "Holiday permanently delete ho gaya"
        });
    } catch (error) {
        console.error("❌ ERROR:", error.message);
        return errorResponse(res, 500, "Permanent delete karne me problem hui");
    }
};

console.log("✅ HolidayController.js successfully load ho gaya");