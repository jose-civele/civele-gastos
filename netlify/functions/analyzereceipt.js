exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { photoB64 } = JSON.parse(event.body);

    if (!photoB64) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No image provided' }) };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: photoB64
              }
            },
            {
              type: 'text',
              text: `Analiza este recibo o factura colombiana. IMPORTANTE: Extrae los datos del VENDEDOR/PROVEEDOR (quien vende el producto/servicio), NO del cliente que compra.

RESTRICCIÓN CRÍTICA:
- Si el vendedor/proveedor es "CIVELE" o NIT "901661192" o "901661192-1", RECHAZA y devuelve un error.
- CIVELE es el EMPLEADOR/CLIENTE que COMPRA, no es el vendedor.
- Busca el VERDADERO PROVEEDOR en la factura (el que vende).

CAMPOS A EXTRAER:

1. "numero_factura": Número de factura (busca "Factura #", "Invoice", "Factura No.", "N° Factura", "Ref.", en la parte superior del documento). Si no encuentras, busca en el pie de página o lado derecho.

2. "descripcion": Descripción DETALLADA de lo que se compró. Incluye:
   - Qué productos/servicios se adquirieron
   - Cantidades (si aparecen)
   - Concepto principal del gasto
   - Ejemplo: "Catering para 20 personas - Almuerzo ejecutivo" o "Transporte terrestre Bogotá-Cartagena, 4 pasajeros"
   - Si la factura es compleja, extrae el detalle de lo que aparece en los renglones/items.

Extrae en JSON estricto:
{"subtotal":numero_sin_puntos_ni_comas,"iva":numero_iva_si_aparece_sino_0,"impoconsumo":numero_impoconsumo_si_aparece_sino_0,"total":numero_total,"fecha":"DD/MM/YYYY","receptor":"nombre del VENDEDOR/PROVEEDOR","nit":"NIT o cédula del VENDEDOR","ciudad":"ciudad","tipo_documento":"Factura electrónica|Recibo de caja|Tiquete|Comprobante|Otro","numero_factura":"número de factura","descripcion":"descripción detallada de productos/servicios","porcentaje_iva":numero_porcentaje_iva_si_es_visible_sino_null,"error":null}

Si el vendedor es CIVELE (901661192), responde:
{"error":"El vendedor no puede ser CIVELE (NIT 901661192). Busca el proveedor real en la factura."}

VALIDACIONES FINALES:
- subtotal+iva+impoconsumo debe ser igual a total
- Si no se discrimina IVA, pon iva:0 e impoconsumo:0 y el total en subtotal
- numero_factura NO puede estar vacío (busca con cuidado)
- descripcion debe ser descriptiva y útil (no genérica como "productos" o "servicios")
- SOLO RESPONDE JSON.`
            }
          ]
        }]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Anthropic API error:', error);
      return { statusCode: response.status, body: JSON.stringify({ error: 'API error' }) };
    }

    const data = await response.json();
    const jsonText = (data.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim();
    let extracted = JSON.parse(jsonText);

    // Validación adicional del lado servidor
    if (extracted.error) {
      return { statusCode: 400, body: JSON.stringify(extracted) };
    }

    const civeleNITs = ['901661192', '901661192-1', '901.661.192', '901.661.192-1'];
    const isCivele = extracted.receptor && (
      extracted.receptor.toUpperCase().includes('CIVELE') ||
      (extracted.nit && civeleNITs.includes(extracted.nit.replace(/[.-]/g, '')))
    );

    if (isCivele) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'El vendedor no puede ser CIVELE. Busca el proveedor real en la factura.',
          receptor: extracted.receptor,
          nit: extracted.nit
        })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify(extracted)
    };

  } catch (error) {
    console.error('Error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
