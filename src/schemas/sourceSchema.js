// this is what sander asked: keeping format and protocol strictly separate
import { z } from 'zod';
import { validateSafeUrl, isPrivateOrLocalHost } from '../utils/urlValidator.js';

// checking connection details so unsafe URLs or private IPs are blocked
const connectionConfigSchema = z.record(z.any()).default({}).superRefine((config, ctx) => {
  if (config.url) {
    try {
      // this will make sure its safe: blocking local files and private IPs
      validateSafeUrl(config.url);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['url'],
        message: err.message
      });
    }
  }

  if (config.host) {
    if (isPrivateOrLocalHost(config.host)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['host'],
        message: `Access to private or local host '${config.host}' is blocked for security.`
      });
    }
  }
});

// schema for creating a brand new supplier source
export const sourceCreateSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  // this is the data format: csv, xml, or api
  type: z.enum(['csv', 'xml', 'api']),
  // this is the transport protocol: HTTP or FTP
  protocol: z
    .enum(['HTTP', 'FTP', 'HTTPS', 'SFTP', 'http', 'ftp', 'https', 'sftp'])
    .default('HTTP')
    .transform((p) => p.toUpperCase()),
  default_model_id: z.string().default('google/gemini-flash-1.5'),
  connection_config: connectionConfigSchema,
  dialect_config: z.record(z.any()).default({}),
  schedule_cron: z.string().nullable().optional(),
});

// schema for updating an existing source
export const sourceUpdateSchema = sourceCreateSchema.partial().extend({
  status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']).optional(),
});