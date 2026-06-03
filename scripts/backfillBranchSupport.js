// scripts/backfillBranchSupport.js
const mongoose = require("mongoose");
const Company = require("../models/Company");
const Branch = require("../models/Branch");
const User = require("../models/User");
const Department = require("../models/Department");
const SidebarConfig = require("../models/SidebarConfig");

const backfillBranchSupport = async () => {
  console.log("🚀 Starting Multi-Branch Support Data Migration...");

  try {
    const companies = await Company.find({});
    console.log(`📋 Found ${companies.length} companies to inspect.`);

    let totalBranchesCreated = 0;
    let totalUsersUpdated = 0;
    let totalDepartmentsUpdated = 0;
    let totalSidebarConfigsUpdated = 0;

    for (const company of companies) {
      console.log(`\n🏢 Inspecting Company: ${company.companyName} (${company.companyCode})`);

      // 1. Check if any branch exists for this company
      let defaultBranch = await Branch.findOne({ company: company._id, isDefault: true });
      
      if (!defaultBranch) {
        // Look for any branch
        defaultBranch = await Branch.findOne({ company: company._id });
      }

      if (!defaultBranch) {
        // Create Default "Head Office" Branch
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
        console.log(`  ✅ Created default branch 'Head Office' (code: ${branchCode})`);
      } else {
        console.log(`  ℹ️ Found existing branch: '${defaultBranch.name}' (code: ${defaultBranch.branchCode})`);
      }

      const defaultBranchId = defaultBranch._id;
      const defaultBranchCode = defaultBranch.branchCode;

      // 2. Backfill Users (Employees and Clients) without branch
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
        console.log(`  ✅ Migrated ${result.modifiedCount} Users (including clients) to this branch.`);
      } else {
        console.log(`  ℹ️ All users already have a branch assigned.`);
      }

      // 3. Backfill Departments without branch
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
        console.log(`  ✅ Migrated ${result.modifiedCount} Departments to this branch.`);
      } else {
        console.log(`  ℹ️ All departments already have a branch assigned.`);
      }

      // 4. Backfill Sidebar Configurations without branch
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
        console.log(`  ✅ Migrated ${result.modifiedCount} Sidebar Configurations to this branch.`);
      } else {
        console.log(`  ℹ️ All sidebar configs already have a branch assigned.`);
      }
    }

    console.log(`
🎉 ====================================================
✅ Migration completed successfully!
✅ Default Branches Created: ${totalBranchesCreated}
✅ Users Migrated: ${totalUsersUpdated}
✅ Departments Migrated: ${totalDepartmentsUpdated}
✅ Sidebar Configs Migrated: ${totalSidebarConfigsUpdated}
======================================================
`);
  } catch (error) {
    console.error("❌ Migration failed with error:", error);
  }
};

module.exports = backfillBranchSupport;
