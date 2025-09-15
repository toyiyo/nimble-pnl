-- Enable leaked password protection in auth settings
UPDATE auth.config SET 
  password_leak_protection = TRUE
WHERE TRUE;