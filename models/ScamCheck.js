import mongoose from 'mongoose';

const scamCheckSchema = new mongoose.Schema(
  {
    // Inputs
    inputText:    { type: String, default: null },
    inputUrl:     { type: String, default: null },
    filesUploaded:[{ type: String }],
    fileCount:    { type: Number, default: 0 },

    // NLP
    nlpScore:   { type: Number },
    nlpVerdict: { type: String },

    // AI output
    verdict:          { type: String, enum: ['Legitimate', 'Suspicious', 'Likely Scam', 'Confirmed Scam'] },
    confidence:       { type: Number },
    scamType:         { type: String },
    verdictStatement: { type: String },
    redFlags:         [{ type: String }],
    whatTheyWant:     { type: String },
    howItWorks:       { type: String },
    whatCanGoWrong:   [{ type: String }],
    nextSteps:        [{ type: String }],
    summary:          { type: String },
  },
  { timestamps: true }
);

export default mongoose.model('ScamCheck', scamCheckSchema);