const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const connectDB = require("./config/db");
const path = require("path");
dotenv.config();
const app = express();

app.set('trust proxy', 1);
connectDB();

app.use(cors({
  origin: ['https://cds.ciisnetwork.in', 'http://localhost:5173','http://147.93.106.84','http://localhost:8080'],
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));


// Middleware
app.use(express.json()); // For JSON requests
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // 🔽 Serve uploaded files statically

// Routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/leads", require("./routes/leadRoutes"));
app.use("/api/calls", require("./routes/callRoutes"));
app.use("/api/followups", require("./routes/followUpRoutes"));
app.use("/api/dashboard", require("./routes/dashboardRoutes"));
app.use("/api/attendance", require("./HR-CDS/routes/attendanceRoutes"));
app.use("/api/leaves", require("./HR-CDS/routes/LeaveRoutes"));
app.use("/api/assets", require("./HR-CDS/routes/assetsRoute"));
app.use("/api/task", require("./HR-CDS/routes/taskRoute"));
app.use("/api/users", require("./HR-CDS/routes/userRoutes"));
app.use("/api/users/profile", require("./HR-CDS/routes/profileRoute"));
app.use("/api/alerts", require("./HR-CDS/routes/alertRoutes"));
app.use("/api/holidays", require("./HR-CDS/routes/Holiday"));
app.use("/api/groups",require("./HR-CDS/routes/groupRoutes"));
app.use("/api/projects", require("./HR-CDS/routes/projectRoutes"));
// 404 fallback
app.get("/api", (req, res) => {
  res.json({ message: "✅ API is live" });
});

app.use((req, res) => {
  res.status(404).json({ message: "🔴 Route not found" });
});

// Start server
const PORT = process.env.PORT || 6000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));