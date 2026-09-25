<#ftl output_format="HTML" auto_esc=true>
<#macro aetherEmail preheader index eyebrow title description actionLabel actionLink expiration caution>
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>AETHER</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f3f6fc;color:#17264b;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;font-size:1px;line-height:1px;color:#f3f6fc;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background-color:#f3f6fc;">
      <tr>
        <td align="center" style="padding:38px 14px 44px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;border-collapse:separate;">
            <tr>
              <td style="padding:0 2px 18px;color:#607295;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">AETHER / ACCESO SEGURO</td>
            </tr>
            <tr>
              <td style="background-color:#142653;border-radius:18px 18px 0 0;padding:27px 38px 25px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">
                  <tr>
                    <td valign="middle" style="color:#ffffff;font-size:21px;font-weight:800;letter-spacing:5px;line-height:1.2;">AETHER</td>
                    <td align="right" valign="middle" style="color:#b6c9f7;font-size:10px;font-weight:700;letter-spacing:1.8px;white-space:nowrap;">${index}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background-color:#ffffff;padding:43px 38px 38px;border-left:1px solid #dce5f6;border-right:1px solid #dce5f6;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">
                  <tr>
                    <td style="padding:0 0 19px;color:#2345af;font-size:10px;font-weight:800;letter-spacing:2.2px;line-height:1.5;text-transform:uppercase;">${eyebrow}</td>
                  </tr>
                  <tr>
                    <td style="padding:0 0 19px;color:#142653;font-size:34px;font-weight:700;letter-spacing:-1.2px;line-height:1.16;">${title}</td>
                  </tr>
                  <tr>
                    <td style="padding:0 0 28px;color:#536483;font-size:16px;line-height:1.7;">${description}</td>
                  </tr>
                  <tr>
                    <td style="padding:0 0 30px;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
                        <tr>
                          <td bgcolor="#2345af" style="background-color:#2345af;border-radius:9px;text-align:center;">
                            <a href="${actionLink}" style="display:inline-block;padding:16px 24px;border:1px solid #2345af;border-radius:9px;color:#ffffff;font-size:14px;font-weight:700;line-height:1.3;text-decoration:none;">${actionLabel}&nbsp;&nbsp;→</a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:17px 20px;background-color:#f3f7ff;border-left:3px solid #4773d9;border-radius:0 7px 7px 0;color:#344c7f;font-size:13px;line-height:1.6;">Este enlace estará disponible durante <strong>${expiration}</strong>.</td>
                  </tr>
                  <tr>
                    <td style="padding:29px 0 0;color:#64738e;font-size:12px;line-height:1.7;">Si el botón no funciona, copia este enlace y pégalo en tu navegador:<br><a href="${actionLink}" style="color:#2345af;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">${actionLink}</a></td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background-color:#e9effa;border:1px solid #dce5f6;border-top:0;border-radius:0 0 18px 18px;padding:23px 38px 26px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">
                  <tr>
                    <td style="color:#344866;font-size:12px;line-height:1.65;">${caution}</td>
                  </tr>
                  <tr>
                    <td style="padding-top:17px;color:#7687a2;font-size:10px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;">AETHER · Todo conectado</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:20px 20px 0;color:#8795ac;font-size:11px;line-height:1.6;">Este es un mensaje automático relacionado con la seguridad de tu cuenta.</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
</#macro>
