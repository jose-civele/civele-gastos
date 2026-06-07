exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { photoB64, tipoGasto } = JSON.parse(event.body);

    if (!photoB64) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No image provided' }) };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
    }

    // PROMPTS MEJORADOS CON EJEMPLOS Y VALIDACIONES MÁS ESTRICTAS
    let promptText = '';

    if (tipoGasto === 'factura') {
      promptText = `ANALIZA ESTA FACTURA COMERCIAL CON MÁXIMA PRECISIÓN.

⚠️ RESTRICCIÓN CRÍTICA:
- Si el VENDEDOR es "CIVELE" o NIT "901661192" o "901661192-1", RECHAZA.
- CIVELE es el CLIENTE que COMPRA, NO el vendedor.
- Busca el VERDADERO PROVEEDOR en la factura.

📍 DÓNDE BUSCAR CADA CAMPO:
1. "receptor" (VENDEDOR): En el encabezado de la factura, lado izquierdo o derecho. Ej: "Restaurante La Provincia", "Lubricantes XYZ S.A."
2. "nit": Junto al nombre del vendedor, formato XXX.XXX.XXX-X o XXXXXXXXX. Ej: "900.456.789-1"
3. "fecha": Usualmente arriba a la derecha. Formato DD/MM/YYYY o similar. Busca palabras: "Fecha", "Date", "Emisión"
4. "numero_factura": En la parte superior. Busca: "Factura #", "Invoice", "No.", "Ref.", "Comprobante #"
5. "descripcion": En la sección de detalle/items. Incluye QUÉ se compró, CUÁNTO (cantidad) y PARA QUÉ.
   Ejemplos CORRECTOS: "Catering 20 personas - Almuerzo ejecutivo", "Gasolina 40 litros - Exxon"
   Ejemplos INCORRECTOS: "Servicios", "Productos", "Mercancía"
6. "ciudad": Generalmente en el encabezado del vendedor. Ej: "Bogotá", "Medellín"
7. "subtotal", "iva", "total": En la sección de totales/resumen, usualmente al final.

EXTRAE EN JSON ESTRICTO (NO agregues texto extra):
{
  "subtotal": número_sin_puntos_ni_comas,
  "iva": número_iva_o_0,
  "impoconsumo": número_impoconsumo_o_0,
  "total": número_total,
  "fecha": "DD/MM/YYYY",
  "receptor": "nombre EXACTO del vendedor",
  "nit": "NIT exacto del vendedor",
  "ciudad": "ciudad",
  "tipo_documento": "Factura electrónica|Recibo de caja|Tiquete|Comprobante|Otro",
  "numero_factura": "número exacto de factura",
  "descripcion": "descripción detallada: QUÉ + CANTIDAD + PARA QUÉ",
  "porcentaje_iva": número_porcentaje_o_null,
  "error": null
}

VALIDACIONES ESTRICTAS:
✓ subtotal + iva + impoconsumo DEBE ser igual a total (tolerancia: ±1)
✓ receptor NO puede estar vacío ni ser genérico
✓ numero_factura NO puede estar vacío
✓ descripcion DEBE ser específica, NOT genérica (mínimo 10 caracteres descriptivos)
✓ fecha DEBE estar en formato DD/MM/YYYY
✓ Si NO encuentras un campo, devuelve error indicando cuál falta

ERROR SI FALTA INFORMACIÓN CRÍTICA:
{"error":"Falta información crítica: [especifica cuáles campos faltan]. Por favor, toma una foto más clara mostrando estos datos."}

SOLO RESPONDE JSON, NADA MÁS.`;

    } else if (tipoGasto === 'reintegro') {
      promptText = `ANALIZA ESTE RECIBO DE GASTO PERSONAL CON MÁXIMA PRECISIÓN.

El empleado pagó esto de su bolsillo y quiere recuperar el dinero.

📍 DÓNDE BUSCAR CADA CAMPO:
1. "receptor" (VENDEDOR): ¿Dónde pagó? Ej: "Estación de servicio Petrobras", "Farmacia Punto Salud", "Taxi Amarillo"
2. "nit": Número de identificación del vendedor (si aparece)
3. "fecha": Cuándo compró. Busca: "Fecha", "Date", "Hora"
4. "numero_factura": Número del recibo/comprobante (si aparece)
5. "total": Cuánto pagó en total
6. "descripcion": QUÉ COMPRÓ EXACTAMENTE. Incluye:
   - PRODUCTO/SERVICIO específico
   - CANTIDAD (si aplica)
   - PARA QUÉ (propósito del gasto)
   Ejemplos CORRECTOS: "Gasolina 30 litros - Combustible vehículo proyecto", "Almuerzo 2 personas - Viaje a cliente"
   Ejemplos INCORRECTOS: "Gastos", "Comida", "Combustible"
7. "ciudad": Dónde compró (si aparece)

EXTRAE EN JSON ESTRICTO:
{
  "subtotal": número_sin_puntos_ni_comas,
  "iva": número_iva_o_0,
  "impoconsumo": número_impoconsumo_o_0,
  "total": número_total,
  "fecha": "DD/MM/YYYY",
  "receptor": "nombre del vendedor",
  "nit": "NIT si aparece, sino vacío",
  "ciudad": "ciudad si aparece, sino vacío",
  "tipo_documento": "Recibo|Tiquete|Factura|Comprobante|Otro",
  "numero_factura": "número si aparece",
  "descripcion": "QUÉ compró + CANTIDAD + PARA QUÉ",
  "porcentaje_iva": número_porcentaje_o_null,
  "error": null
}

VALIDACIONES ESTRICTAS:
✓ total DEBE ser > 0
✓ receptor NO puede estar vacío
✓ descripcion DEBE ser específica y útil (mínimo 15 caracteres descriptivos)
✓ Si hay subtotal e iva: subtotal + iva DEBE ≈ total
✓ Fecha en formato DD/MM/YYYY

ERROR SI INFORMACIÓN CRÍTICA FALTA:
{"error":"Falta información: [especifica]. El recibo debe mostrar: qué se compró y cuánto se pagó."}

SOLO RESPONDE JSON, NADA MÁS.`;
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
        max_tokens: 600,
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
              text: promptText
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

    // Validación: Rechazar si es error
    if (extracted.error) {
      return { statusCode: 400, body: JSON.stringify(extracted) };
    }

    // SOLO PARA FACTURA: Validar que no sea CIVELE
    if (tipoGasto === 'factura') {
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
    }

    // Validaciones finales del lado del servidor
    if (!extracted.receptor || extracted.receptor.trim() === '') {
      return { statusCode: 400, body: JSON.stringify({ error: 'Falta el nombre del vendedor/proveedor' }) };
    }

    if (!extracted.descripcion || extracted.descripcion.trim().length < 10) {
      return { statusCode: 400, body: JSON.stringify({ error: 'La descripción debe ser más detallada. Incluye: QUÉ se compró, CANTIDAD y PARA QUÉ.' }) };
    }

    if (!extracted.total || extracted.total <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No se encontró el monto total válido' }) };
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
