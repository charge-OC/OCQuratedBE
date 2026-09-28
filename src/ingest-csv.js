import fs from 'fs';
import { parse } from 'csv-parse';
import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Zod Schema Definition
const ProductSchema = z.object({
  sku: z.string().trim().min(1, "SKU is required"),
  name: z.string().trim().min(1, "Name is required"),
  threadSize: z.string().trim().nullable().transform(v => v === "" ? null : v),
  lengthMm: z.number().nullable(),
  material: z.string().trim().transform(v => v.toUpperCase()),
  finish: z.string().trim().nullable().transform(v => v === "" ? null : v),
  grade: z.string().trim().nullable().transform(v => v === "" ? null : v),
  priceExcl: z.number().positive("Price must be positive"),
  stock: z.number().int().nonnegative("Stock must be non-negative")
});

export const parseCsvFile = (targetPath) => {
  return new Promise((resolve, reject) => {
    const validProducts = [];
    const flaggedRecords = [];
    let totalRowsProcessed = 0;

    fs.createReadStream(targetPath)
      .pipe(parse({
        columns: true,
        skip_empty_lines: true,
        trim: true
      }))
      .on('data', (row) => {
        totalRowsProcessed++;

        // Map raw Dutch merchant headers to camelCase
        const mappedRecord = {
          sku: row.artikel_nr,
          name: row.omschrijving,
          threadSize: row.schroefdraad_maat || null,
          lengthMm: row.lengte_mm ? (isNaN(parseFloat(row.lengte_mm)) ? null : parseFloat(row.lengte_mm)) : null,
          material: row.materiaal || "",
          finish: row.oppervlaktebehandeling || null,
          grade: row.sterkteklasse || null,
          priceExcl: row.prijs_excl ? parseFloat(row.prijs_excl) : -1,
          stock: row.voorraad ? parseInt(row.voorraad, 10) : -1
        };

        // Validate against Zod schema
        const result = ProductSchema.safeParse(mappedRecord);

        if (result.success) {
          validProducts.push(result.data);
        } else {
          flaggedRecords.push({
            rowNumber: totalRowsProcessed,
            rawRecord: row,
            errors: result.error.issues.map(err => `${err.path.join('.')}: ${err.message}`)
          });
        }
      })
      .on('end', () => {
        resolve({
          totalRowsProcessed,
          validRecordsCount: validProducts.length,
          flaggedRecordsCount: flaggedRecords.length,
          validProducts,
          flaggedRecords
        });
      })
      .on('error', (err) => {
        reject(err);
      });
  });
};

// Check if running directly as a script
if (process.argv[1] === __filename) {
  const csvFilePath = path.join(__dirname, '..', 'mock_pushop.csv');
  parseCsvFile(csvFilePath)
    .then(summary => console.log(JSON.stringify(summary, null, 2)))
    .catch(err => console.error('Error parsing CSV:', err));
}
