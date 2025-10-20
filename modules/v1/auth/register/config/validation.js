import { z } from 'zod';

export const registerUserSchema = z.object({
    name: z.string().nonempty("Name is required").max(100, "Name must be at most 100 characters long"),
    email: z.string().nonempty("Email is required").email("Invalid email format"),
    password: z.string().nonempty("Password is required").min(8, "Password must be at least 8 characters long"),
});