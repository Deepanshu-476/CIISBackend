const mongoose = require("mongoose");
const SalaryStructure = require("../models/SalaryStructure");
const SalaryComponent = require("../models/SalaryComponent");
const getCompany = req => req.user?.company?._id || req.user?.company;
const normalize = (body = {}) => ({
  name: String(body.name || "").trim(), code: String(body.code || "").trim().toUpperCase(), salaryType: body.salaryType || "monthly",
  salaryInputType: body.salaryInputType || "gross", effectiveFrom: body.effectiveFrom, description: String(body.description || "").trim(), status: body.status || "active",
  components: (Array.isArray(body.components) ? body.components : []).map((row, i) => ({ component: row.component?._id || row.component,
    calculationType: row.calculationType || "manual", calculationBase: String(row.calculationBase || "").trim(), value: Number(row.value || 0),
    formula: String(row.formula || "").trim(), sortOrder: Number(row.sortOrder || i + 1) })),
});
const validate = async (p, company) => {
  if (!p.name || !p.code || !p.effectiveFrom || Number.isNaN(new Date(p.effectiveFrom).getTime())) return "Structure name, code, and a valid effective date are required.";
  if (!["monthly", "annual"].includes(p.salaryType) || !["gross", "ctc"].includes(p.salaryInputType) || !["active", "inactive"].includes(p.status)) return "Invalid salary structure configuration.";
  if (!p.components.length) return "Add at least one salary component.";
  const ids = p.components.map(row => String(row.component || ""));
  if (ids.some(id => !mongoose.isValidObjectId(id)) || new Set(ids).size !== ids.length) return "Salary components must be valid and unique.";
  if (p.components.some(row => !["manual", "percentage", "formula"].includes(row.calculationType) || row.sortOrder < 1 || row.value < 0 || (row.calculationType === "formula" && !row.formula))) return "Invalid component calculation settings.";
  return await SalaryComponent.countDocuments({ _id: { $in: ids }, company }) === ids.length ? null : "One or more salary components do not belong to this company.";
};
const populate = query => query.populate("components.component", "name code type status");
exports.list = async (req, res) => { try { const company = getCompany(req); if (!company) return res.status(400).json({ success:false, message:"Company is required." }); const structures = await populate(SalaryStructure.find({ company }).sort({ updatedAt:-1 })).lean(); res.json({ success:true, structures }); } catch { res.status(500).json({ success:false, message:"Unable to load salary structures." }); } };
exports.create = async (req, res) => { try { const company=getCompany(req), p=normalize(req.body); if(!company)return res.status(400).json({success:false,message:"Company is required."}); const e=await validate(p,company); if(e)return res.status(400).json({success:false,message:e}); let structure=await SalaryStructure.create({...p,company,createdBy:req.user.id,updatedBy:req.user.id}); structure=await structure.populate("components.component","name code type status"); res.status(201).json({success:true,message:"Salary structure created successfully.",structure}); } catch(e){ res.status(e?.code===11000?409:500).json({success:false,message:e?.code===11000?"This salary structure code is already in use.":"Unable to create salary structure."}); } };
exports.update = async (req,res) => { try { const company=getCompany(req),p=normalize(req.body); if(!company||!mongoose.isValidObjectId(req.params.id))return res.status(400).json({success:false,message:"Invalid request."}); const e=await validate(p,company); if(e)return res.status(400).json({success:false,message:e}); let structure=await SalaryStructure.findOneAndUpdate({_id:req.params.id,company},{...p,updatedBy:req.user.id},{new:true,runValidators:true}); if(!structure)return res.status(404).json({success:false,message:"Salary structure not found."}); structure=await structure.populate("components.component","name code type status"); res.json({success:true,message:"Salary structure updated successfully.",structure}); } catch(e){res.status(e?.code===11000?409:500).json({success:false,message:e?.code===11000?"This salary structure code is already in use.":"Unable to update salary structure."});} };
exports.remove = async (req,res) => { try { const company=getCompany(req); if(!company||!mongoose.isValidObjectId(req.params.id))return res.status(400).json({success:false,message:"Invalid request."}); const item=await SalaryStructure.findOneAndDelete({_id:req.params.id,company}); if(!item)return res.status(404).json({success:false,message:"Salary structure not found."}); res.json({success:true,message:"Salary structure deleted successfully."}); } catch {res.status(500).json({success:false,message:"Unable to delete salary structure."});} };
