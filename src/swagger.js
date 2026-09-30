export const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Qurated Backend API',
    version: '1.0.0',
    description: 'API documentation for the Qurated supplier ingestion and source management system.',
  },
  servers: [
    {
      url: '/api',
      description: 'Local development server',
    },
  ],
  components: {
    parameters: {
      MerchantIdHeader: {
        in: 'header',
        name: 'x-merchant-id',
        required: true,
        schema: { type: 'string', default: 'default-merchant' },
        description: 'Tenant isolation identifier',
      },
    },
    schemas: {
      Source: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          merchant_id: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string' },
          default_model_id: { type: 'string' },
          connection_config: { type: 'object' },
          schedule_cron: { type: 'string', nullable: true },
          status: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
          last_run_at: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      IngestionRun: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          source_id: { type: 'string', format: 'uuid' },
          merchant_id: { type: 'string' },
          status: { type: 'string', enum: ['PROCESSING', 'COMPLETED', 'FAILED'] },
          started_at: { type: 'string', format: 'date-time' },
          finished_at: { type: 'string', format: 'date-time', nullable: true },
          total_rows: { type: 'integer' },
          valid_rows: { type: 'integer' },
          failed_rows: { type: 'integer' },
          error_message: { type: 'string', nullable: true },
        },
      },
    },
  },
  paths: {
    '/sources': {
      get: {
        summary: 'List all sources',
        tags: ['Sources'],
        parameters: [{ $ref: '#/components/parameters/MerchantIdHeader' }],
        responses: {
          200: { description: 'A list of sources' },
        },
      },
      post: {
        summary: 'Create a new source',
        tags: ['Sources'],
        parameters: [{ $ref: '#/components/parameters/MerchantIdHeader' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'type', 'default_model_id'],
                properties: {
                  name: { type: 'string', example: 'HVH Local Sample Feed' },
                  type: { type: 'string', example: 'xml' },
                  default_model_id: { type: 'string', example: 'google/gemini-flash-1.5' },
                  connection_config: { type: 'object', properties: { url: { type: 'string', example: 'sample-feed.xml' } } },
                  schedule_cron: { type: 'string', example: '0 2 * * *' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Source created successfully' },
        },
      },
    },
    '/sources/{id}': {
      get: {
        summary: 'Get a specific source',
        tags: ['Sources'],
        parameters: [
          { $ref: '#/components/parameters/MerchantIdHeader' },
          { in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'Source details' },
        },
      },
      delete: {
        summary: 'Delete a specific source',
        tags: ['Sources'],
        parameters: [
          { $ref: '#/components/parameters/MerchantIdHeader' },
          { in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'Source deleted' },
        },
      },
    },
    '/sources/{id}/sync': {
      post: {
        summary: 'Trigger manual source sync',
        tags: ['Ingestion'],
        parameters: [
          { $ref: '#/components/parameters/MerchantIdHeader' },
          { in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          202: { description: 'Ingestion started in the background' },
          409: { description: 'Sync already in progress' },
        },
      },
    },
    '/sources/{id}/runs': {
      get: {
        summary: 'List all ingestion runs for a source',
        tags: ['Ingestion'],
        parameters: [
          { $ref: '#/components/parameters/MerchantIdHeader' },
          { in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'List of runs' },
        },
      },
    },
    '/sources/runs/{runId}': {
      get: {
        summary: 'Fetch specific run status',
        tags: ['Ingestion'],
        parameters: [
          { $ref: '#/components/parameters/MerchantIdHeader' },
          { in: 'path', name: 'runId', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'Run details' },
        },
      },
    },
    '/extract': {
      post: {
        summary: 'Test AI extraction (Mock)',
        tags: ['Utility & Testing'],
        responses: { 200: { description: 'Mock extraction result' } }
      }
    },
    '/ingest-csv': {
      post: {
        summary: 'Test CSV Parsing',
        tags: ['Utility & Testing'],
        requestBody: {
          content: {
            'application/json': { schema: { type: 'object', properties: { filePath: { type: 'string' } } } }
          }
        },
        responses: { 200: { description: 'CSV parsing summary' } }
      }
    },
    '/lineage/{documentId}': {
      get: {
        summary: 'Get AI extraction lineage',
        tags: ['Utility & Testing'],
        parameters: [{ in: 'path', name: 'documentId', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Lineage data' } }
      }
    }
  },
};