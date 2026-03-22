# PaySure Backend

Node.js + Express + MongoDB + OpenAI API

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your .env file
cp .env.example .env
# Fill in MONGO_URI and OPENAI_API_KEY

# 3. Run in development
npm run dev

# 4. Server runs on
http://localhost:5000
```

## API Endpoints

| Method | Route | Body / File |
|--------|-------|-------------|
| GET  | `/api/health` | — |
| POST | `/api/loan-risk/analyze` | `{ monthlyIncome, monthlyEMI, loanAmount, tenureMonths, interestRate }` |
| GET  | `/api/loan-risk/history` | — |
| POST | `/api/scam-check/analyze` | `{ text }` |
| GET  | `/api/scam-check/history` | — |
| POST | `/api/agreement/analyze` | `form-data: document (PDF)` |
| GET  | `/api/agreement/history` | — |

## Sample Request — Loan Risk

```json
POST /api/loan-risk/analyze
{
  "monthlyIncome": 50000,
  "monthlyEMI": 18000,
  "loanAmount": 500000,
  "tenureMonths": 36,
  "interestRate": 12.5
}
```

## Sample Response

```json
{
  "success": true,
  "data": {
    "id": "...",
    "monthlyIncome": 50000,
    "monthlyEMI": 18000,
    "emiToIncomeRatio": 36,
    "totalRepayment": 648000,
    "totalInterest": 148000,
    "riskScore": 6,
    "riskLevel": "Moderate",
    "suggestions": [
      "Consider reducing EMI by extending tenure to 48 months",
      "Your EMI is above the recommended 30% threshold",
      "Build an emergency fund before taking this loan"
    ],
    "summary": "Your loan EMI is 36% of your monthly income..."
  }
}
```

## Project Structure

```
paysure-backend/
├── server.js
├── .env.example
├── config/
│   ├── db.js          MongoDB connection
│   └── openai.js      OpenAI client
├── routes/
│   ├── loanRisk.js
│   ├── scamCheck.js
│   └── agreementAnalysis.js
├── controllers/
│   ├── loanRiskController.js
│   ├── scamCheckController.js
│   └── agreementController.js
├── services/
│   ├── openaiService.js   Structured Outputs wrapper
│   └── pdfService.js      PDF text extraction
├── middleware/
│   ├── errorHandler.js
│   ├── upload.js          Multer config
│   └── validate.js        Zod validation
└── models/
    ├── LoanAnalysis.js
    ├── ScamCheck.js
    └── AgreementAnalysis.js
```