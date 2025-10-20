import { z } from 'zod';

export const loginUserSchema = z.object({
    email: z.string().nonempty("Email is required").email("Invalid email format"),
    password: z.string().nonempty("Password is required"),
});