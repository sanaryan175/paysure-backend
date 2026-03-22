import express from 'express';
import { z } from 'zod';
import { register, login, getMe } from '../controllers/authController.js';
import protect from '../middleware/auth.js';

const router = express.Router();

const registerSchema = z.object({
  name:     z.string().min(2, 'Name must be at least 2 characters'),
  email:    z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const loginSchema = z.object({
  email:    z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const message = result.error.errors.map(e => e.message).join(', ');
    return res.status(400).json({ success: false, message });
  }
  req.body = result.data;
  next();
};

router.post('/register', validate(registerSchema), register);
router.post('/login',    validate(loginSchema),    login);
router.get('/me',        protect,                  getMe);

export default router;