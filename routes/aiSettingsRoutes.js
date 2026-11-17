const express = require("express");
const router = express.Router();
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

// GET /api/ai-settings: Super Admin retrieves current AI settings
router.get("/", protect, restrictTo("super_admin"), async (req, res) => {
  try {
    const settings = await AiSettings.getOrCreateSettings();
    const result = {
      _id: settings._id,
      primaryApiKeyMasked: maskApiKey(settings.primaryApiKey),
      secondaryApiKeyMasked: maskApiKey(settings.secondaryApiKey),
      hasPrimaryApiKey: Boolean(settings.primaryApiKey),
      hasSecondaryApiKey: Boolean(settings.secondaryApiKey),
      selectedModel: settings.selectedModel || "qwen/qwen3.8-27b",
      selectedSttModel: settings.selectedSttModel || "whisper-large-v3-turbo",
      isEnabled: settings.isEnabled !== false,
      lastTestedAt: settings.lastTestedAt,
      testStatus: settings.testStatus,
      testMessage: settings.testMessage,
      updatedAt: settings.updatedAt,
    };

    return res.json({ success: true, settings: result });
  } catch (error) {
    console.error("❌ Get AI settings error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch AI settings" });
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
      settings: {
        _id: settings._id,
        primaryApiKeyMasked: maskApiKey(settings.primaryApiKey),
        secondaryApiKeyMasked: maskApiKey(settings.secondaryApiKey),
        hasPrimaryApiKey: Boolean(settings.primaryApiKey),
        hasSecondaryApiKey: Boolean(settings.secondaryApiKey),
        selectedModel: settings.selectedModel,
        selectedSttModel: settings.selectedSttModel,
        isEnabled: settings.isEnabled,
        testStatus: settings.testStatus,
        testMessage: settings.testMessage,
        lastTestedAt: settings.lastTestedAt,
      },
    });
  } catch (error) {
    console.error("❌ Save AI settings error:", error);
    return res.status(500).json({ success: false, message: "Failed to save AI settings" });
  }
});

module.exports = router;
