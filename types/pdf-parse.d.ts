declare module "pdf-parse" {
  export default function pdfParse(
    data: Buffer | Uint8Array,
  ): Promise<{
    text: string;
    numpages: number;
    numrender: number;
    info?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    version?: string;
  }>;
}
