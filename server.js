import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import connectDB from './config/db.js';
import errorHandler from './middleware/errorHandler.js';
import protect from './middleware/auth.js';

// Routes
import authRoutes       from './routes/Auth.js';
import loanRiskRoutes   from './routes/loanRisk.js';
import scamCheckRoutes  from './routes/scamCheck.js';
import agreementRoutes  from './routes/agreementAnalysis.js';

connectDB();

const app = express();

app.use(cors({ origin: '*', credentials: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'PaySure API is running', timestamp: new Date().toISOString() });
});

// Public routes
app.use('/api/auth', authRoutes);

// Protected routes — must be logged in
app.use('/api/loan-risk',  protect, loanRiskRoutes);
app.use('/api/scam-check', protect, scamCheckRoutes);
app.use('/api/agreement',  protect, agreementRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

// Global error handler
app.use(errorHandler);

// Crash catchers
process.on('unhandledRejection', (reason) => console.error('[UNHANDLED REJECTION]', reason));
process.on('uncaughtException',  (err)    => { console.error('[UNCAUGHT EXCEPTION]', err.message); });

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`PaySure backend running on http://localhost:${PORT}`));