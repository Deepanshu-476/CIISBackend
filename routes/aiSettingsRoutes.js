const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const AiSettings = require("../models/AiSettings");
const { protect, restrictTo } = require("../middleware/authMiddleware");
const { refreshKeyCache } = require("../services/ai/groqKeyManager");

const maskApiKey = (key) => {
  if (!key || typeof key !== "string") return "";
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "********";
  return trimmed.slice(0, 6) + "..." + trimmed.slice(-4);
};

/**
 * Validates a Groq API key against Groq's live /openai/v1/models endpoint
 */
const testGroqApiKey = async (apiKey) => {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim().startsWith("gsk_")) {
    return {
      isValid: false,
      message: "API Key must start with 'gsk_' and be a valid Groq API key.",
    };
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      signal: AbortSignal.timeout(8000),
    });

    if (response.ok) {
      const data = await response.json();
      const models = Array.isArray(data.data) ? data.data.map((m) => m.id) : [];
      return {
        isValid: true,
        message: "Connection successful! Groq API key is valid and active.",
        models,
      };
    }

    if (response.status === 401) {
      return {
        isValid: false,
        message: "Invalid API Key. Authentication failed with Groq.",
      };
    }

    if (response.status === 429) {
      return {
        isValid: false,
        message: "Rate limit reached for this Groq API Key.",
      };
    }

    const errorText = await response.text().catch(() => "");
    return {
      isValid: false,
      message: `Groq error (HTTP ${response.status}): ${errorText.slice(0, 150)}`,
    };
  } catch (err) {
    if (err.name === "TimeoutError") {
      return {
        isValid: false,
        message: "Connection timed out while connecting to Groq API.",
      };
    }
    return {
      isValid: false,
      message: `Network error: ${err.message}`,
    };
  }
};

const formatSettingsResponse = (settings) => {
  const activePrimaryVaultId = settings.primaryVaultId || null;
  const activeSecondaryVaultId = settings.secondaryVaultId || null;

  const vault = (settings.keyVault || []).map((item) => {
    const isPrimary = activePrimaryVaultId
      ? activePrimaryVaultId === item.id
      : Boolean(settings.primaryApiKey && settings.primaryApiKey === item.apiKey);
    const isSecondary = activeSecondaryVaultId
      ? activeSecondaryVaultId === item.id
      : Boolean(settings.secondaryApiKey && settings.secondaryApiKey === item.apiKey);

    return {
      id: item.id,
      label: item.label,
      apiKeyMasked: maskApiKey(item.apiKey),
      isPrimary,
      isSecondary,
      status: item.status,
      lastTestedAt: item.lastTestedAt,
      addedAt: item.addedAt,
    };
  });

  const activePrimaryItem = (settings.keyVault || []).find((k) =>
    activePrimaryVaultId ? k.id === activePrimaryVaultId : k.apiKey === settings.primaryApiKey
  );

  return {
    _id: settings._id,
    primaryApiKeyMasked: maskApiKey(settings.primaryApiKey),
    secondaryApiKeyMasked: maskApiKey(settings.secondaryApiKey),
    hasPrimaryApiKey: Boolean(settings.primaryApiKey),
    hasSecondaryApiKey: Boolean(settings.secondaryApiKey),
    primaryVaultId: settings.primaryVaultId,
    secondaryVaultId: settings.secondaryVaultId,
    primaryLabel: activePrimaryItem ? activePrimaryItem.label : "",
    keyVault: vault,
    selectedModel: settings.selectedModel || "qwen/qwen3.8-27b",
    selectedSttModel: settings.selectedSttModel || "whisper-large-v3-turbo",
    isEnabled: settings.isEnabled !== false,
    lastTestedAt: settings.lastTestedAt,
    testStatus: settings.testStatus,
    testMessage: settings.testMessage,
    updatedAt: settings.updatedAt,
  };
};

// GET /api/ai-settings: Super Admin retrieves current AI settings + Key Vault
router.get("/", protect, restrictTo("super_admin"), async (req, res) => {
  try {
    const settings = await AiSettings.getOrCreateSettings();
    return res.json({ success: true, settings: formatSettingsResponse(settings) });
  } catch (error) {
    console.error("❌ Get AI settings error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch AI settings" });
  }
});

// POST /api/ai-settings/vault/add: Add a new API key to the Vault
router.post("/vault/add", protect, restrictTo("super_admin"), async (req, res) => {
  try {
    const { label, apiKey, setAsPrimary, setAsSecondary } = req.body;

    if (!label || typeof label !== "string" || !label.trim()) {
      return res.status(400).json({ success: false, message: "Please provide a friendly label for this key." });
    }
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim().startsWith("gsk_")) {
      return res.status(400).json({ success: false, message: "API Key must start with 'gsk_' and be a valid Groq API key." });
    }

    const settings = await AiSettings.getOrCreateSettings();
    const cleanKey = apiKey.trim();
    const cleanLabel = label.trim();

    // Check duplicate key
    const duplicate = (settings.keyVault || []).find((k) => k.apiKey === cleanKey);
    if (duplicate) {
      return res.status(400).json({
        success: false,
        message: `This API Key already exists in the vault under the name "${duplicate.label}".`,
      });
    }

    // Live test key
    const testResult = await testGroqApiKey(cleanKey);
    const newId = new mongoose.Types.ObjectId().toString();

    const vaultItem = {
      id: newId,
      label: cleanLabel,
      apiKey: cleanKey,
      status: testResult.isValid ? "valid" : "invalid",
      lastTestedAt: new Date(),
      addedAt: new Date(),
    };

    if (!settings.keyVault) settings.keyVault = [];
    settings.keyVault.push(vaultItem);

    if (setAsPrimary) {
      settings.primaryApiKey = cleanKey;
      settings.primaryVaultId = newId;
      settings.testStatus = vaultItem.status;
      settings.testMessage = testResult.message;
      settings.lastTestedAt = new Date();
      if (settings.secondaryVaultId === newId) {
        settings.secondaryVaultId = null;
        settings.secondaryApiKey = "";
      }
    } else if (setAsSecondary) {
      settings.secondaryApiKey = cleanKey;
      settings.secondaryVaultId = newId;
      if (settings.primaryVaultId === newId) {
        settings.primaryVaultId = null;
        settings.primaryApiKey = "";
      }
    }

    settings.updatedBy = req.user?._id || null;
    await settings.save();

    if (setAsPrimary || setAsSecondary) {
      await refreshKeyCache();
    }

    return res.json({
      success: true,
      message: `Key "${cleanLabel}" saved to vault successfully!`,
      settings: formatSettingsResponse(settings),
    });
  } catch (error) {
    console.error("❌ Add to vault error:", error);
    return res.status(500).json({ success: false, message: "Failed to add key to vault" });
  }
});

// POST /api/ai-settings/vault/set-active: One-click switch Primary or Secondary key
router.post("/vault/set-active", protect, restrictTo("super_admin"), async (req, res) => {
  try {
    const { vaultId, target } = req.body;
    if (!vaultId || !["primary", "secondary"].includes(target)) {
      return res.status(400).json({ success: false, message: "Invalid vaultId or target (must be 'primary' or 'secondary')." });
    }

    const settings = await AiSettings.getOrCreateSettings();
    const item = (settings.keyVault || []).find((k) => k.id === vaultId);
    if (!item) {
      return res.status(404).json({ success: false, message: "Key not found in vault." });
    }

    if (target === "primary") {
      // If was secondary, clear secondary
      if (settings.secondaryVaultId === item.id) {
        settings.secondaryVaultId = null;
        settings.secondaryApiKey = "";
      }
      settings.primaryApiKey = item.apiKey;
      settings.primaryVaultId = item.id;

      // Retest key connectivity
      const test = await testGroqApiKey(item.apiKey);
      item.status = test.isValid ? "valid" : "invalid";
      item.lastTestedAt = new Date();
      settings.testStatus = item.status;
      settings.testMessage = test.message;
      settings.lastTestedAt = item.lastTestedAt;
    } else if (target === "secondary") {
      if (settings.primaryVaultId === item.id) {
        return res.status(400).json({
          success: false,
          message: "This key is currently active as Primary. Select another key for Primary before setting it as Secondary.",
        });
      }
      settings.secondaryApiKey = item.apiKey;
      settings.secondaryVaultId = item.id;
    }

    settings.updatedBy = req.user?._id || null;
    await settings.save();
    await refreshKeyCache();

    return res.json({
      success: true,
      message: `Key "${item.label}" is now set as ${target === "primary" ? "Active Primary" : "Secondary Fallback"}!`,
      settings: formatSettingsResponse(settings),
    });
  } catch (error) {
    console.error("❌ Set active key error:", error);
    return res.status(500).json({ success: false, message: "Failed to switch active key" });
  }
});

// POST /api/ai-settings/vault/:id/test: Test a specific key in the vault
router.post("/vault/:id/test", protect, restrictTo("super_admin"), async (req, res) => {
  try {
    const { id } = req.params;
    const settings = await AiSettings.getOrCreateSettings();
    const item = (settings.keyVault || []).find((k) => k.id === id);
    if (!item) {
      return res.status(404).json({ success: false, message: "Key not found in vault." });
    }

    const testResult = await testGroqApiKey(item.apiKey);
    item.status = testResult.isValid ? "valid" : "invalid";
    item.lastTestedAt = new Date();

    if (settings.primaryVaultId === item.id || settings.primaryApiKey === item.apiKey) {
      settings.testStatus = item.status;
      settings.testMessage = testResult.message;
      settings.lastTestedAt = item.lastTestedAt;
    }

    await settings.save();

    return res.json({
      success: true,
      isValid: testResult.isValid,
      message: testResult.message,
      item: {
        id: item.id,
        label: item.label,
        status: item.status,
        lastTestedAt: item.lastTestedAt,
      },
    });
  } catch (error) {
    console.error("❌ Test vault key error:", error);
    return res.status(500).json({ success: false, message: "Failed to test key" });
  }
});

// DELETE /api/ai-settings/vault/:id: Remove a key from vault
router.delete("/vault/:id", protect, restrictTo("super_admin"), async (req, res) => {
  try {
    const { id } = req.params;
    const settings = await AiSettings.getOrCreateSettings();
    const itemIndex = (settings.keyVault || []).findIndex((k) => k.id === id);
    if (itemIndex === -1) {
      return res.status(404).json({ success: false, message: "Key not found in vault." });
    }

    const item = settings.keyVault[itemIndex];
    if (settings.primaryVaultId === item.id || settings.primaryApiKey === item.apiKey) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete active Primary key "${item.label}". Please set another key as Primary before deleting.`,
      });
    }

    if (settings.secondaryVaultId === item.id || settings.secondaryApiKey === item.apiKey) {
      settings.secondaryVaultId = null;
      settings.secondaryApiKey = "";
    }

    settings.keyVault.splice(itemIndex, 1);
    settings.updatedBy = req.user?._id || null;
    await settings.save();
    await refreshKeyCache();

    return res.json({
      success: true,
      message: `Key "${item.label}" deleted from vault.`,
      settings: formatSettingsResponse(settings),
    });
  } catch (error) {
    console.error("❌ Delete vault key error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete key from vault" });
  }
});

// POST /api/ai-settings/test: Super Admin tests a Groq API key live before saving
router.post("/test", protect, restrictTo("super_admin"), async (req, res) => {
  try {
    let apiKey = req.body?.apiKey;
    if (!apiKey) {
      const current = await AiSettings.getOrCreateSettings();
      apiKey = current.primaryApiKey;
    }

    if (!apiKey) {
      return res.status(400).json({
        success: false,
        isValid: false,
        message: "Please enter a Groq API Key to test.",
      });
    }

    const testResult = await testGroqApiKey(apiKey);
    return res.json({
      success: true,
      isValid: testResult.isValid,
      message: testResult.message,
      models: testResult.models || [],
    });
  } catch (error) {
    console.error("❌ Test AI key error:", error);
    return res.status(500).json({ success: false, message: "Internal server error during key test" });
  }
});

// PUT /api/ai-settings: Super Admin updates API keys and models
router.put("/", protect, restrictTo("super_admin"), async (req, res) => {
  try {
    const {
      primaryApiKey,
      secondaryApiKey,
      selectedModel,
      selectedSttModel,
      isEnabled,
    } = req.body;

    const settings = await AiSettings.getOrCreateSettings();

    if (primaryApiKey !== undefined && primaryApiKey !== "") {
      settings.primaryApiKey = String(primaryApiKey).trim();
    }
    if (secondaryApiKey !== undefined) {
      settings.secondaryApiKey = String(secondaryApiKey || "").trim();
    }
    if (selectedModel) {
      settings.selectedModel = String(selectedModel).trim();
    }
    if (selectedSttModel) {
      settings.selectedSttModel = String(selectedSttModel).trim();
    }
    if (isEnabled !== undefined) {
      settings.isEnabled = Boolean(isEnabled);
    }

    settings.updatedBy = req.user?._id || null;

    // Test primary key connectivity on save if provided
    if (settings.primaryApiKey) {
      const test = await testGroqApiKey(settings.primaryApiKey);
      settings.testStatus = test.isValid ? "valid" : "invalid";
      settings.testMessage = test.message;
      settings.lastTestedAt = new Date();
    }

    await settings.save();

    // Instantly invalidate backend in-memory cache so all requests immediately switch to new key!
    if (refreshKeyCache) {
      await refreshKeyCache();
    }

    return res.json({
      success: true,
      message: "AI settings saved and switched successfully!",
      settings: formatSettingsResponse(settings),
    });
  } catch (error) {
    console.error("❌ Save AI settings error:", error);
    return res.status(500).json({ success: false, message: "Failed to save AI settings" });
  }
});

module.exports = router;
