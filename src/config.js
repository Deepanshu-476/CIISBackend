
// src/config/index.ts
import dotenv from 'dotenv';
import { z } from 'zod';
dotenv.config();

const EnvSchema = z.object({
  PORT: z.string().default('4000'),
  MONGO_URI: z.string().url().or(z.string().startsWith('mongodb://')),
  JWT_SECRET: z.string().min(10),
  JWT_EXPIRES_IN: z.string().default('7d'),
  APP_BASE_URL: z.string().url(),
  SMTP_HOST: z.string(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().email(),
  SMTP_PASS: z.string(),
  FROM_EMAIL: z.string().default('No Reply <noreply@example.com>'),
  FORGOT_LIMIT_PER_HOUR: z.coerce.number().default(5),
  RESET_TOKEN_TTL_MINUTES: z.coerce.number().default(30),
});

const env = EnvSchema.parse(process.env);

export const config = {
  port: Number(env.PORT),
  mongoUri: env.MONGO_URI,
  jwt: { secret: env.JWT_SECRET, expiresIn: env.JWT_EXPIRES_IN },
  appBaseUrl: env.APP_BASE_URL,
  email: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.FROM_EMAIL,
    
  },
  security: {
    forgotLimitPerHour: env.FORGOT_LIMIT_PER_HOUR,
    resetTokenTTLminutes: env.RESET_TOKEN_TTL_MINUTES,
  },
};

