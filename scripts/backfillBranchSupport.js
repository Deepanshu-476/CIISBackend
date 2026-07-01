
const mongoose = require("mongoose");
const Company = require("../models/Company");
const Branch = require("../models/Branch");
const User = require("../models/User");
const Department = require("../models/Department");
const SidebarConfig = require("../models/SidebarConfig");

const backfillBranchSupport = async () => {
  void 0;

  try {
    const companies = await Company.find({});
    void 0;

    let totalBranchesCreated = 0;
    let totalUsersUpdated = 0;
    let totalDepartmentsUpdated = 0;
    let totalSidebarConfigsUpdated = 0;

    for (const company of companies) {
      void 0;

      
      let defaultBranch = await Branch.findOne({ company: company._id, isDefault: true });
      
      if (!defaultBranch) {
        
        defaultBranch = await Branch.findOne({ company: company._id });
      }

      if (!defaultBranch) {
        
        const codeBase = String(company.companyCode || "CMP").substring(0, 7);
        const branchCode = `${codeBase}-HQ`.toUpperCase();

        defaultBranch = await Branch.create({
          name: "Head Office",
          branchCode,
          company: company._id,
          companyCode: company.companyCode || "CMP",
          address: company.companyAddress || "",
          phone: company.companyPhone || "",
          isDefault: true,
          isActive: true,
        });

        totalBranchesCreated++;
        void 0;
      } else {
        void 0;
      }

      const defaultBranchId = defaultBranch._id;
      const defaultBranchCode = defaultBranch.branchCode;

      
      const usersToUpdate = await User.find({
        company: company._id,
        $or: [{ branch: { $exists: false } }, { branch: null }],
      });

      if (usersToUpdate.length > 0) {
        const userIds = usersToUpdate.map((u) => u._id);
        const result = await User.updateMany(
          { _id: { $in: userIds } },
          {
            $set: {
              branch: defaultBranchId,
              branchCode: defaultBranchCode,
            },
          }
        );
        totalUsersUpdated += result.modifiedCount;
        void 0;
      } else {
        void 0;
      }
      
      
      const deptsToUpdate = await Department.find({
        company: company._id,
        $or: [{ branch: { $exists: false } }, { branch: null }],
      });

      if (deptsToUpdate.length > 0) {
        const deptIds = deptsToUpdate.map((d) => d._id);
        const result = await Department.updateMany(
          { _id: { $in: deptIds } },
          {
            $set: {
              branch: defaultBranchId,
              branchCode: defaultBranchCode,
            },
          }
        );
        totalDepartmentsUpdated += result.modifiedCount;
        void 0;
      } else {
        void 0;
      }

      
      const configsToUpdate = await SidebarConfig.find({
        companyId: company._id,
        $or: [{ branchId: { $exists: false } }, { branchId: null }],
      });

      if (configsToUpdate.length > 0) {
        const configIds = configsToUpdate.map((c) => c._id);
        const result = await SidebarConfig.updateMany(
          { _id: { $in: configIds } },
          {
            $set: {
              branchId: defaultBranchId,
            },
          }
        );
        totalSidebarConfigsUpdated += result.modifiedCount;
        void 0;
      } else {
        void 0;
      }
    }

    void 0;
  } catch (error) {
    console.error("❌ Migration failed with error:", error);
  }
};

module.exports = backfillBranchSupport;
