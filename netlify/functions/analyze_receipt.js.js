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
        max_tokens: 400,
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
              text: `Analiza este recibo o factura colombiana. Extrae los datos en JSON estricto, sin texto adicional:
{"subtotal":numero_sin_puntos_ni_comas,"iva":numero_iva_si_aparece_sino_0,"impoconsumo":numero_impoconsumo_si_aparece_sino_0,"total":numero_total,"fecha":"DD/MM/YYYY","receptor":"nombre del establecimiento","nit":"NIT o cédula","ciudad":"ciudad","tipo_documento":"Factura electrónica|Recibo de caja|Tiquete|Comprobante|Otro","porcentaje_iva":numero_porcentaje_iva_si_es_visible_sino_null}
Importante: subtotal+iva+impoconsumo debe ser igual a total. Si no se discrimina IVA, pon iva:0 e impoconsumo:0 y el total en subtotal. SOLO el JSON.`
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
    const extracted = JSON.parse(jsonText);

    return {
      statusCode: 200,
      body: JSON.stringify(extracted)
    };

  } catch (error) {
    console.error('Error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
