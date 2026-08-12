// ============================================
// SERVICIO DE BOT DE WHATSAPP INTEGRADO
// ============================================

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const config = require('./config_whatsapp');

const {
  AREAS, ALLOWED_NUMBERS, NOMBRES, TIMEZONE,
  IGNORE_OLD_MESSAGES_SECONDS, RECORDATORIOS,
  RESUMEN_HORA, RESUMEN_MINUTO, ADMIN_NUMERO, MENSAJES_SALIDA,
} = config;

let dbInstance = null;
let client = null;
let readyTime = null;
let enviadosHoy = new Set();
let flagResumenEnviadoHoy = false;

function nombreDe(telefono) { return NOMBRES[telefono] || telefono; }
function horaStr(fecha) {
  return fecha.toLocaleString('es-419', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone: TIMEZONE
  });
}
function duracion(inicio, fin) {
  const ms = fin - inicio;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function msgBienvenida() {
  let t = '📋 *Sistema de Registro de Áreas*\n\nSelecciona un área para registrar tu *ENTRADA*:\n\n';
  AREAS.forEach(a => t += `  ${a.id}. ${a.nombre}\n`);
  t += '\n💡 Escribe el *número* del área.';
  return t;
}
function msgEntrada(area, h) {
  return `✅ *ENTRADA registrada*\n\n📍 Área: *${area.nombre}*\n🕐 Hora: *${h}*\n\nCuando termines, escribe *"salir"*.`;
}
function msgSalida(tel, area, hEnt, hSal, dur) {
  const nombre = nombreDe(tel);
  const tpl = MENSAJES_SALIDA[tel];
  if (tpl) {
    return tpl
      .replace(/{nombre}/g, nombre)
      .replace(/{area}/g, area.nombre)
      .replace(/{duracion}/g, dur)
      .replace(/{horaEntrada}/g, hEnt)
      .replace(/{horaSalida}/g, hSal);
  }
  return `🔴 *SALIDA registrada*\n\n📍 Área: *${area.nombre}*\n🕐 Entrada: ${hEnt}\n🕐 Salida: ${hSal}\n⏱️ Duración: *${dur}*\n\nPuedes entrar a otra área. Escribe *"areas"*.`;
}
function msgEstado(s) {
  if (!s) return '⚪ No tienes sesión activa.\nEscribe *"areas"* para ver la lista.';
  return `🟢 *Sesión activa*\n\n📍 Área: *${s.area_nombre}*\n🕐 Entrada: ${s.entrada}\n\nEscribe *"salir"* cuando termines.`;
}

async function generarResumen() {
  if (!dbInstance) return '📊 *Resumen del día*\n\nBase de datos no disponible.';
  const hoy = new Date().toLocaleDateString('es-419', { timeZone: TIMEZONE });
  const regs = await dbInstance.all('SELECT * FROM whatsapp_registros ORDER BY id ASC');
  const hoyRegs = regs.filter(r => {
    const f = new Date(r.timestamp_entrada || r.timestamp_salida || Date.now())
      .toLocaleDateString('es-419', { timeZone: TIMEZONE });
    return f === hoy;
  });
  if (hoyRegs.length === 0) return `📊 *Resumen del día*\n${hoy}\n\nNo hay registros hoy.`;

  const porPersona = {};
  hoyRegs.forEach(r => { (porPersona[r.telefono] ||= []).push(r); });

  let t = `📊 *RESUMEN DEL DÍA*\n${hoy}\n\n`;
  Object.entries(porPersona).forEach(([tel, rs]) => {
    rs.sort((a, b) => new Date(a.timestamp_entrada || 0) - new Date(b.timestamp_entrada || 0));
    t += `👤 *${nombreDe(tel)}*\n`;
    let totalMs = 0;
    rs.forEach(r => {
      if (r.tipo === 'ENTRADA') {
        const sal = rs.find(x => x.tipo === 'SALIDA' && x.area_id === r.area_id && new Date(x.timestamp_salida) > new Date(r.timestamp_entrada));
        if (sal) {
          const d = duracion(new Date(r.timestamp_entrada), new Date(sal.timestamp_salida));
          t += `   • ${r.area_nombre} → ${r.entrada} a ${sal.salida} | ${d}\n`;
          totalMs += new Date(sal.timestamp_salida) - new Date(r.timestamp_entrada);
        } else {
          t += `   • ${r.area_nombre} → ${r.entrada} a ??? | ⚠️ SIN CERRAR\n`;
        }
      }
    });
    if (totalMs > 0) {
      const th = Math.floor(totalMs / 3600000), tm = Math.floor((totalMs % 3600000) / 60000);
      t += `   ⏱️ Total: ${th}h ${tm}m\n`;
    }
    t += '\n';
  });

  const sesionesActivas = await dbInstance.all('SELECT * FROM whatsapp_sesiones_activas');
  if (sesionesActivas.length > 0) {
    t += '🔴 *SESIONES ACTIVAS AHORA*:\n';
    sesionesActivas.forEach(s => {
      t += `   ${nombreDe(s.telefono)}: ${s.area_nombre} desde ${s.entrada} (${duracion(new Date(s.entrada_raw), new Date())})\n`;
    });
  }
  return t;
}

async function enviarResumenAdmin() {
  if (!client) return;
  try {
    const resumen = await generarResumen();
    await client.sendMessage(ADMIN_NUMERO, resumen);
    flagResumenEnviadoHoy = true;
    console.log('📊 Resumen diario enviado al admin vía WhatsApp.');
  } catch (e) {
    console.error('❌ Error enviando resumen:', e.message);
  }
}

async function cerrarSesionPorAdmin(telefono, msgAdmin = null) {
  if (!dbInstance) return { success: false, error: 'DB no inicializada' };
  const s = await dbInstance.get('SELECT * FROM whatsapp_sesiones_activas WHERE telefono = ?', [telefono]);
  if (!s) {
    if (msgAdmin) await msgAdmin.reply(`⚠️ ${nombreDe(telefono)} no tiene sesión activa.`);
    return { success: false, error: 'Sesión no encontrada' };
  }
  const ahora = new Date(), h = horaStr(ahora);
  const area = AREAS.find(a => a.id === s.area_id) || { nombre: s.area_nombre };
  const dur = duracion(new Date(s.entrada_raw), ahora);

  await dbInstance.run(`
    INSERT INTO whatsapp_registros (telefono, tipo, area_id, area_nombre, entrada, salida, duracion, timestamp_salida, cerrado_por_admin)
    VALUES (?, 'SALIDA', ?, ?, ?, ?, ?, ?, 1)
  `, [telefono, s.area_id, s.area_nombre, s.entrada, h, dur, ahora.toISOString()]);

  await dbInstance.run('DELETE FROM whatsapp_sesiones_activas WHERE telefono = ?', [telefono]);

  if (msgAdmin) {
    await msgAdmin.reply(`✅ Sesión de *${nombreDe(telefono)}* cerrada.\n📍 ${area.nombre || s.area_nombre}\n⏱️ ${dur}`);
  }
  try {
    if (client) {
      await client.sendMessage(telefono, `🔴 Tu sesión en *${area.nombre || s.area_nombre}* fue cerrada por el administrador.\n🕐 Entrada: ${s.entrada}\n🕐 Salida: ${h}\n⏱️ ${dur}`);
    }
  } catch {}
  return { success: true };
}

function resetDiario() {
  const horaActual = parseInt(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: TIMEZONE }));
  if (horaActual === 0) {
    enviadosHoy.clear();
    flagResumenEnviadoHoy = false;
  }
}

async function revisarCron() {
  const ahora = new Date();
  const hora = parseInt(ahora.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: TIMEZONE }));
  const min = parseInt(ahora.toLocaleString('en-US', { minute: 'numeric', timeZone: TIMEZONE }));
  const seg = parseInt(ahora.toLocaleString('en-US', { second: 'numeric', timeZone: TIMEZONE }));
  resetDiario();

  for (const rec of RECORDATORIOS) {
    const key = `${rec.hora}:${rec.minuto}`;
    if (hora === rec.hora && min === rec.minuto && seg < 10 && !enviadosHoy.has(key)) {
      enviadosHoy.add(key);
      if (dbInstance && client) {
        const sesionesActivas = await dbInstance.all('SELECT * FROM whatsapp_sesiones_activas');
        let c = 0;
        for (const s of sesionesActivas) {
          try { await client.sendMessage(s.telefono, rec.mensaje); c++; } catch {}
        }
        console.log(`🔔 Recordatorio WhatsApp ${key} → ${c} persona(s)`);
      }
    }
  }

  const rk = `${RESUMEN_HORA}:${RESUMEN_MINUTO}`;
  if (hora === RESUMEN_HORA && min === RESUMEN_MINUTO && seg < 10 && !enviadosHoy.has(rk) && !flagResumenEnviadoHoy) {
    enviadosHoy.add(rk);
    await enviarResumenAdmin();
  }
}

function iniciarBotWhatsApp(db) {
  dbInstance = db;
  console.log('🤖 Inicializando cliente de WhatsApp Web...');
  
  try {
    client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
    });

    client.on('qr', qr => {
      console.log('\n📱 Escanea este código QR para WhatsApp Bot:');
      try {
        qrcode.generate(qr, { small: true });
      } catch (e) {
        console.log('QR Code:', qr);
      }
    });

    client.on('ready', () => {
      readyTime = Date.now();
      console.log('\n✅ Bot de WhatsApp listo y conectado!');
      console.log(`📊 Áreas configuradas: ${AREAS.map(a => a.nombre).join(', ')}`);
      console.log(`👥 Números autorizados: ${ALLOWED_NUMBERS.length}`);
      console.log(`👤 Admin WhatsApp: ${nombreDe(ADMIN_NUMERO)} (${ADMIN_NUMERO})\n`);
      setInterval(revisarCron, 60000);
    });

    client.on('disconnected', reason => {
      console.log('\n⚠️ WhatsApp desconectado:', reason);
      setTimeout(() => {
        try { client.initialize(); } catch (e) { console.error('Error reinicializando cliente WhatsApp:', e.message); }
      }, 5000);
    });

    client.on('message', async msg => {
      if (!dbInstance) return;
      const tel = msg.from;
      const txtOrig = msg.body.trim();
      const txt = txtOrig.toLowerCase();
      const ahora = new Date();
      const h = horaStr(ahora);

      if (msg.fromMe) return;
      if (tel.endsWith('@g.us')) return;
      if (readyTime && (msg.timestamp * 1000 < (readyTime - IGNORE_OLD_MESSAGES_SECONDS * 1000))) return;

      const ok = ALLOWED_NUMBERS.includes(tel);
      console.log(`[WhatsApp ${h}] ${ok ? '✅' : '❌'} ${nombreDe(tel)} (${tel}) → "${txtOrig}"`);
      if (!ok) return;

      // Admin commands
      if (txt === 'resumen' && tel === ADMIN_NUMERO) {
        await msg.reply(await generarResumen());
        return;
      }
      if (txt.startsWith('cerrar ') && tel === ADMIN_NUMERO) {
        const p = txtOrig.split(' ');
        if (p.length >= 2) {
          let t = p[1].trim();
          if (!t.includes('@')) t += '@c.us';
          await cerrarSesionPorAdmin(t, msg);
          return;
        }
        await msg.reply('⚠️ Uso: cerrar 199939468558544@lid');
        return;
      }

      // Standard commands
      if (['hola', 'areas', 'ayuda', 'menu', 'inicio'].includes(txt)) {
        await msg.reply(msgBienvenida());
        return;
      }
      if (txt === 'estado') {
        const s = await dbInstance.get('SELECT * FROM whatsapp_sesiones_activas WHERE telefono = ?', [tel]);
        await msg.reply(msgEstado(s));
        return;
      }

      if (txt === 'salir') {
        const s = await dbInstance.get('SELECT * FROM whatsapp_sesiones_activas WHERE telefono = ?', [tel]);
        if (!s) {
          await msg.reply('⚠️ No tienes sesión activa.\nEscribe *"areas"*.');
          return;
        }
        const area = AREAS.find(a => a.id === s.area_id) || { nombre: s.area_nombre };
        const dur = duracion(new Date(s.entrada_raw), ahora);

        await dbInstance.run(`
          INSERT INTO whatsapp_registros (telefono, tipo, area_id, area_nombre, entrada, salida, duracion, timestamp_salida)
          VALUES (?, 'SALIDA', ?, ?, ?, ?, ?, ?)
        `, [tel, s.area_id, s.area_nombre, s.entrada, h, dur, ahora.toISOString()]);

        await dbInstance.run('DELETE FROM whatsapp_sesiones_activas WHERE telefono = ?', [tel]);

        await msg.reply(msgSalida(tel, area, s.entrada, h, dur));
        return;
      }

      const areaId = parseInt(txt);
      if (!isNaN(areaId)) {
        const area = AREAS.find(a => a.id === areaId);
        if (!area) {
          await msg.reply('❌ Área no válida. Escribe *"areas"*.');
          return;
        }
        const act = await dbInstance.get('SELECT * FROM whatsapp_sesiones_activas WHERE telefono = ?', [tel]);
        if (act) {
          await msg.reply(`⚠️ Ya estás en *${act.area_nombre}*. Escribe *"salir"* primero.`);
          return;
        }

        await dbInstance.run(`
          INSERT INTO whatsapp_sesiones_activas (telefono, area_id, area_nombre, entrada, entrada_raw)
          VALUES (?, ?, ?, ?, ?)
        `, [tel, area.id, area.nombre, h, ahora.toISOString()]);

        await dbInstance.run(`
          INSERT INTO whatsapp_registros (telefono, tipo, area_id, area_nombre, entrada, timestamp_entrada)
          VALUES (?, 'ENTRADA', ?, ?, ?, ?)
        `, [tel, area.id, area.nombre, h, ahora.toISOString()]);

        await msg.reply(msgEntrada(area, h));
        return;
      }
    });

    client.initialize();
  } catch (e) {
    console.error('⚠️ No se pudo inicializar WhatsApp Bot (continuando sin bot activo):', e.message);
  }
}

module.exports = {
  iniciarBotWhatsApp,
  generarResumen,
  enviarResumenAdmin,
  cerrarSesionPorAdmin,
  nombreDe
};
