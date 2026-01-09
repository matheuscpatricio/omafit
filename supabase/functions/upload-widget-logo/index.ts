import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-file-name, x-content-type",
  "Access-Control-Max-Age": "3600",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight - DEVE retornar 200 OK
  if (req.method === "OPTIONS") {
    const origin = req.headers.get("Origin") || "*";
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-file-name, x-content-type",
        "Access-Control-Max-Age": "3600",
        "Access-Control-Allow-Credentials": "true",
      },
    });
  }

  try {
    // Receber arquivo diretamente como FormData ou ArrayBuffer
    const contentType = req.headers.get('content-type') || '';
    
    let fileName: string;
    let binaryData: Uint8Array;
    let fileContentType: string;

    if (contentType.includes('multipart/form-data')) {
      // Se for FormData
      const formData = await req.formData();
      const file = formData.get('file') as File;
      
      if (!file) {
        throw new Error('Arquivo não encontrado no FormData');
      }

      fileName = formData.get('fileName') as string || `${crypto.randomUUID()}-${Date.now()}.${file.name.split('.').pop() || 'png'}`;
      fileContentType = file.type;
      binaryData = new Uint8Array(await file.arrayBuffer());
    } else if (contentType.includes('application/json')) {
      // Fallback para JSON (compatibilidade)
      const { fileName: jsonFileName, fileData, contentType: jsonContentType } = await req.json();
      
      if (!jsonFileName || !fileData) {
        throw new Error('fileName e fileData são obrigatórios');
      }

      fileName = jsonFileName;
      fileContentType = jsonContentType || 'image/png';
      
      // Converter base64 para Uint8Array (se necessário)
      if (fileData.startsWith('data:')) {
        const base64Data = fileData.split(',')[1];
        binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
      } else {
        binaryData = Uint8Array.from(atob(fileData), c => c.charCodeAt(0));
      }
    } else {
      // Receber arquivo binário diretamente
      const fileNameHeader = req.headers.get('x-file-name');
      const contentTypeHeader = req.headers.get('x-content-type');
      
      if (!fileNameHeader) {
        throw new Error('Nome do arquivo não fornecido (header x-file-name)');
      }

      fileName = fileNameHeader;
      fileContentType = contentTypeHeader || 'image/png';
      binaryData = new Uint8Array(await req.arrayBuffer());
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Variáveis de ambiente do Supabase não configuradas');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const filePath = `widget-logos/${fileName}`;

    console.log('📤 Fazendo upload do logo:', {
      fileName,
      filePath,
      contentType: fileContentType,
      tamanho: binaryData.length
    });

    // Fazer upload para Supabase Storage
    const { data, error } = await supabase.storage
      .from('Video banner')
      .upload(filePath, binaryData, {
        contentType: fileContentType,
        upsert: true, // Permite sobrescrever se já existir
        cacheControl: '3600'
      });

    if (error) {
      console.error('❌ Erro no upload:', error);
      throw new Error(`Erro ao fazer upload: ${error.message}`);
    }

    // Obter URL pública
    const { data: urlData } = supabase.storage
      .from('Video banner')
      .getPublicUrl(filePath);

    console.log('✅ Logo enviado com sucesso:', urlData.publicUrl);

    const origin = req.headers.get("Origin") || "*";
    return new Response(
      JSON.stringify({
        success: true,
        url: urlData.publicUrl,
        path: filePath
      }),
      {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-file-name, x-content-type",
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error('❌ Erro na Edge Function:', error);
    
    const origin = req.headers.get("Origin") || "*";
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Erro desconhecido ao fazer upload do logo'
      }),
      {
        status: 400,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-file-name, x-content-type",
          "Content-Type": "application/json",
        },
      }
    );
  }
});

