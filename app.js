/* =========================================================================
   Calendario Académico TEC — PWA
   Sin dependencias. Todo el estado vive en localStorage.
   ========================================================================= */
'use strict';

const LS = {
  datos: 'tec.datos',
  urlRemota: 'tec.urlRemota',
  autoAct: 'tec.autoActualizar',
  ultimaRev: 'tec.ultimaRevision',
  tema: 'tec.tema',
  periodo: 'tec.periodoSel'
};

const DIA_MS = 86400000;
const NOMBRE_HITO_CORTO = {
  publicacion: 'Publicación de actas',
  preparacion: 'Preparación de finales',
  evaluaciones: 'Evaluaciones y actividades finales',
  finales: 'Exámenes finales',
  reposicion: 'Reposición / ampliación',
  actas: 'Entrega de actas'
};

let DATOS = null;      // objeto de calendario en uso
let SELECCION = null;  // id del periodo mostrado
let EDITANDO = null;   // id del periodo en el formulario de ajustes

/* ---------------------------------------------------------------- fechas */

/** Convierte "YYYY-MM-DD" en Date local al mediodía (inmune a zonas horarias). */
function d(iso) {
  if (!iso) return null;
  const [a, m, dd] = iso.split('-').map(Number);
  return new Date(a, m - 1, dd, 12, 0, 0, 0);
}
function iso(fecha) {
  const p = n => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}`;
}
function hoy() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12, 0, 0, 0);
}
function sumaDias(fecha, n) {
  const r = new Date(fecha);
  r.setDate(r.getDate() + n);
  return r;
}
/** Lunes de la semana que contiene `fecha` (semana de lunes a domingo). */
function lunesDe(fecha) {
  const r = new Date(fecha);
  const dow = (r.getDay() + 6) % 7; // 0 = lunes
  return sumaDias(r, -dow);
}
function difDias(a, b) {
  return Math.round((b - a) / DIA_MS);
}
function dentro(fecha, ini, fin) {
  return fecha >= ini && fecha <= fin;
}
function seSolapan(a1, a2, b1, b2) {
  return a1 <= b2 && b1 <= a2;
}

const fmtLargo = new Intl.DateTimeFormat('es-CR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtMedio = new Intl.DateTimeFormat('es-CR', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtCorto = new Intl.DateTimeFormat('es-CR', { day: 'numeric', month: 'short' });
const fmtMes = new Intl.DateTimeFormat('es-CR', { month: 'long', year: 'numeric' });

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function rangoTexto(ini, fin) {
  if (!fin || iso(ini) === iso(fin)) return cap(fmtMedio.format(ini));
  const mismoAnio = ini.getFullYear() === fin.getFullYear();
  return `${cap(fmtCorto.format(ini))} – ${cap(mismoAnio ? fmtMedio.format(fin) : fmtMedio.format(fin))}`;
}

function cuentaRegresiva(fecha, ref) {
  const n = difDias(ref, fecha);
  if (n === 0) return 'es hoy';
  if (n === 1) return 'mañana';
  if (n === -1) return 'fue ayer';
  if (n > 0) return `en ${n} días`;
  return `hace ${-n} días`;
}

/* ------------------------------------------------------------ datos base */

/** Copia de respaldo embebida: la app arranca aunque no haya red ni caché. */
const DATOS_EMBEBIDOS_URL = 'data/calendario-tec.json';

async function cargarDatos() {
  const guardado = localStorage.getItem(LS.datos);
  if (guardado) {
    try { return JSON.parse(guardado); } catch (e) { /* cae al archivo */ }
  }
  const r = await fetch(DATOS_EMBEBIDOS_URL, { cache: 'no-cache' });
  if (!r.ok) throw new Error('No se pudo leer ' + DATOS_EMBEBIDOS_URL);
  return await r.json();
}

function guardarDatos(datos) {
  DATOS = datos;
  localStorage.setItem(LS.datos, JSON.stringify(datos));
}

function periodosOrdenados() {
  return [...DATOS.periodos].sort((a, b) => (a.anio - b.anio) || (a.orden - b.orden));
}
function periodoPorId(id) {
  return DATOS.periodos.find(p => p.id === id) || null;
}
function feriadoEn(fechaIso) {
  return (DATOS.feriados || []).filter(f => f.fecha === fechaIso);
}
function hito(p, clave) {
  return (p.hitos || []).find(h => h.clave === clave) || null;
}

/** Último día relevante del periodo (para calendario y estado). */
function finPeriodo(p) {
  let fin = d(p.lectivo.fin);
  for (const h of p.hitos || []) {
    const f = d(h.fin || h.inicio);
    if (f > fin) fin = f;
  }
  return fin;
}

/* -------------------------------------------------- construcción semanal */

/**
 * Devuelve la lista de semanas (lunes a domingo) que cubre el periodo,
 * clasificadas y con la numeración lectiva ya calculada.
 */
function construirSemanas(p) {
  const iniLect = d(p.lectivo.inicio);
  const finLect = d(p.lectivo.fin);
  const fin = finPeriodo(p);
  const recesos = (p.recesos || []).map(r => ({ ...r, i: d(r.inicio), f: d(r.fin) }));
  const bloques = (p.hitos || [])
    .filter(h => !h.derivado && h.clave !== 'actas' && h.clave !== 'publicacion')
    .map(h => ({ ...h, i: d(h.inicio), f: d(h.fin || h.inicio) }));
  const derivados = (p.hitos || [])
    .filter(h => h.derivado)
    .map(h => ({ ...h, i: d(h.inicio), f: d(h.fin || h.inicio) }));

  const semanas = [];
  let cursor = lunesDe(iniLect);
  let n = 0;
  let guarda = 0;

  while (cursor <= fin && guarda++ < 80) {
    const wIni = cursor;
    const wFin = sumaDias(cursor, 6);

    const receso = recesos.find(r => seSolapan(wIni, wFin, r.i, r.f));
    const esLectiva = seSolapan(wIni, wFin, iniLect, finLect);
    const bloque = bloques.find(b => seSolapan(wIni, wFin, b.i, b.f));
    const deriv = derivados.filter(h => seSolapan(wIni, wFin, h.i, h.f));

    let tipo, titulo, numero = null;
    if (receso && !esLectiva) {
      tipo = 'receso'; titulo = receso.nombre || 'Semana no lectiva';
    } else if (receso && esLectiva) {
      // La semana cae dentro del periodo lectivo pero está declarada como receso.
      tipo = 'receso'; titulo = receso.nombre || 'Semana no lectiva';
    } else if (esLectiva) {
      tipo = 'lectiva'; numero = ++n; titulo = `Semana lectiva ${numero}`;
    } else if (bloque && bloque.clave === 'preparacion') {
      tipo = 'preparacion'; titulo = bloque.nombre;
    } else if (bloque) {
      tipo = 'examenes';
      titulo = deriv.length ? deriv.map(x => x.nombre).join(' · ') : bloque.nombre;
    } else {
      tipo = 'otro'; titulo = 'Semana fuera del periodo lectivo';
    }

    // Feriados y fechas límite que caen en la semana.
    const marcas = [];
    for (let k = 0; k < 7; k++) {
      const dia = sumaDias(wIni, k);
      for (const f of feriadoEn(iso(dia))) {
        marcas.push({ tipo: 'feriado', texto: `${f.nombre} (${cap(fmtCorto.format(dia))})` });
      }
    }
    const actas = hito(p, 'actas');
    if (actas) {
      const fa = d(actas.fin || actas.inicio);
      if (dentro(fa, wIni, wFin)) {
        marcas.push({ tipo: 'actas', texto: `Fecha máxima de entrega de actas (${cap(fmtCorto.format(fa))})` });
      }
    }

    semanas.push({ tipo, titulo, numero, ini: wIni, fin: wFin, marcas });
    cursor = sumaDias(cursor, 7);
  }

  return { semanas, totalLectivas: n };
}

/** Clasifica un día concreto dentro del periodo (para el calendario mensual). */
function claseDia(p, fecha) {
  const clases = [];
  const iniLect = d(p.lectivo.inicio), finLect = d(p.lectivo.fin);
  const receso = (p.recesos || []).some(r => dentro(fecha, d(r.inicio), d(r.fin)));

  if (receso) clases.push('d-receso');
  else if (dentro(fecha, iniLect, finLect)) clases.push('d-lectiva');
  else {
    const prep = hito(p, 'preparacion');
    const eval_ = hito(p, 'evaluaciones');
    if (prep && dentro(fecha, d(prep.inicio), d(prep.fin))) clases.push('d-preparacion');
    else if (eval_ && dentro(fecha, d(eval_.inicio), d(eval_.fin))) clases.push('d-examenes');
  }

  const actas = hito(p, 'actas');
  if (actas && iso(fecha) === (actas.fin || actas.inicio)) clases.push('actas');
  if (feriadoEn(iso(fecha)).length) clases.push('feriado');
  const dow = fecha.getDay();
  if (dow === 0 || dow === 6) clases.push('finde');
  return clases;
}

/* ------------------------------------------------------------ estado hoy */

/** Devuelve el periodo que contiene la fecha, o el más cercano en el futuro. */
function periodoDeHoy(ref) {
  const lista = periodosOrdenados();
  const activo = lista.find(p => dentro(ref, d(p.lectivo.inicio), finPeriodo(p)));
  if (activo) return activo;
  const futuro = lista.find(p => d(p.lectivo.inicio) > ref);
  return futuro || lista[lista.length - 1] || null;
}

/** Estado textual de la fecha `ref` dentro del periodo `p`. */
function estadoEn(p, ref) {
  const { semanas, totalLectivas } = construirSemanas(p);
  const iniLect = d(p.lectivo.inicio), fin = finPeriodo(p);

  if (ref < iniLect) {
    return {
      etiqueta: 'Aún no inicia',
      titular: `Faltan ${difDias(ref, iniLect)} días`,
      sub: `El periodo lectivo inicia el ${fmtLargo.format(iniLect)}.`,
      chips: [], progreso: 0, semanas, totalLectivas
    };
  }
  if (ref > fin) {
    return {
      etiqueta: 'Periodo concluido',
      titular: `${p.nombre} finalizó`,
      sub: `El último hito fue el ${fmtLargo.format(fin)}, hace ${difDias(fin, ref)} días.`,
      chips: [], progreso: 1, semanas, totalLectivas
    };
  }

  const sem = semanas.find(s => dentro(ref, s.ini, s.fin));
  const chips = [];
  let etiqueta = 'Hoy', titular = '—', sub = '';

  if (sem) {
    sub = `Semana del ${cap(fmtCorto.format(sem.ini))} al ${cap(fmtMedio.format(sem.fin))}.`;
    if (sem.tipo === 'lectiva') {
      etiqueta = 'Semana lectiva';
      titular = `Semana ${sem.numero} de ${totalLectivas}`;
      chips.push({ clase: 'lectiva', texto: `Faltan ${totalLectivas - sem.numero} semanas lectivas` });
    } else if (sem.tipo === 'receso') {
      etiqueta = 'Semana no lectiva';
      titular = sem.titulo;
      chips.push({ clase: 'receso', texto: 'No hay lecciones' });
    } else if (sem.tipo === 'preparacion') {
      etiqueta = 'Preparación';
      titular = 'Semana de preparación de finales';
      chips.push({ clase: 'prep', texto: 'Terminó el periodo lectivo' });
    } else if (sem.tipo === 'examenes') {
      etiqueta = 'Evaluaciones finales';
      titular = sem.titulo;
      chips.push({ clase: 'examen', texto: 'Semana de exámenes' });
    } else {
      etiqueta = 'Fuera de lecciones';
      titular = sem.titulo;
    }
  }

  const fer = feriadoEn(iso(ref));
  for (const f of fer) chips.push({ clase: 'feriado', texto: `Feriado: ${f.nombre}` });

  const actas = hito(p, 'actas');
  if (actas) {
    const fa = d(actas.fin || actas.inicio);
    const n = difDias(ref, fa);
    if (n >= 0) chips.push({ clase: 'actas', texto: `Entrega de actas: ${n === 0 ? 'HOY' : n + ' días'}` });
  }

  const progreso = Math.min(1, Math.max(0, difDias(iniLect, ref) / Math.max(1, difDias(iniLect, fin))));
  return { etiqueta, titular, sub, chips, progreso, semanas, totalLectivas, sem };
}

/* ------------------------------------------------------------- rendering */

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

function el(tag, clase, texto) {
  const n = document.createElement(tag);
  if (clase) n.className = clase;
  if (texto != null) n.textContent = texto;
  return n;
}

function pintarSelectores() {
  const lista = periodosOrdenados();
  const anios = [...new Set(lista.map(p => p.anio))].sort();
  const sel = periodoPorId(SELECCION) || lista[0];

  const selAnio = $('#selAnio');
  selAnio.innerHTML = '';
  for (const a of anios) {
    const o = el('option', null, String(a));
    o.value = a;
    if (sel && a === sel.anio) o.selected = true;
    selAnio.append(o);
  }

  const selPer = $('#selPeriodo');
  selPer.innerHTML = '';
  for (const p of lista.filter(p => p.anio === Number(selAnio.value))) {
    const o = el('option', null, p.nombre);
    o.value = p.id;
    if (p.id === SELECCION) o.selected = true;
    selPer.append(o);
  }
  if (!selPer.value && selPer.options.length) {
    selPer.selectedIndex = 0;
    SELECCION = selPer.value;
  }
}

function pintarResumen(p) {
  const ref = hoy();
  const pHoy = periodoDeHoy(ref);
  const esElDeHoy = pHoy && pHoy.id === p.id;
  const est = estadoEn(p, ref);

  // Tarjeta principal
  const c = $('#tarjetaHoy');
  c.innerHTML = '';
  c.append(el('div', 'hoy-etiqueta', esElDeHoy ? est.etiqueta : `${p.nombre} — vista`));
  c.append(el('div', 'hoy-titular', est.titular));
  const sub = el('div', 'hoy-sub');
  sub.textContent = est.sub || `${cap(fmtMedio.format(d(p.lectivo.inicio)))} – ${cap(fmtMedio.format(finPeriodo(p)))}`;
  c.append(sub);

  if (est.chips.length) {
    const chips = el('div', 'hoy-chips');
    for (const ch of est.chips) chips.append(el('span', 'chip ' + ch.clase, ch.texto));
    c.append(chips);
  }

  const barra = el('div', 'barra');
  const i = document.createElement('i');
  i.style.width = Math.round(est.progreso * 100) + '%';
  barra.append(i);
  c.append(barra);
  const pie = el('div', 'barra-pie');
  pie.append(el('span', null, cap(fmtCorto.format(d(p.lectivo.inicio)))));
  pie.append(el('span', null, `${est.totalLectivas} semanas lectivas`));
  pie.append(el('span', null, cap(fmtCorto.format(finPeriodo(p)))));
  c.append(pie);

  // Aviso si se está viendo un periodo distinto al de hoy
  const aviso = $('#avisoPeriodo');
  if (!esElDeHoy && pHoy) {
    aviso.textContent = `Está viendo ${p.nombre}. Hoy (${fmtLargo.format(ref)}) corresponde a ${pHoy.nombre}.`;
    aviso.classList.remove('oculto');
  } else {
    aviso.classList.add('oculto');
  }

  // Fechas clave
  const g = $('#fechasClave');
  g.innerHTML = '';

  const tarjetas = [];
  const actas = hito(p, 'actas');
  if (actas) {
    const fa = d(actas.fin || actas.inicio);
    tarjetas.push({
      clave: 'actas', destacada: true,
      titulo: 'Fecha máxima de entrega de actas',
      fecha: cap(fmtLargo.format(fa)),
      cuenta: `${cuentaRegresiva(fa, ref)} · periodo de entrega desde el ${cap(fmtCorto.format(d(actas.inicio)))}`,
      pasada: fa < ref
    });
  }

  tarjetas.push({
    clave: 'lectivo',
    titulo: 'Inicio del periodo lectivo',
    fecha: cap(fmtMedio.format(d(p.lectivo.inicio))),
    cuenta: cuentaRegresiva(d(p.lectivo.inicio), ref),
    pasada: d(p.lectivo.inicio) < ref
  });
  tarjetas.push({
    clave: 'lectivo',
    titulo: 'Fin del periodo lectivo',
    fecha: cap(fmtMedio.format(d(p.lectivo.fin))),
    cuenta: cuentaRegresiva(d(p.lectivo.fin), ref),
    pasada: d(p.lectivo.fin) < ref
  });

  for (const r of p.recesos || []) {
    tarjetas.push({
      clave: 'receso', titulo: r.nombre || 'Semana no lectiva',
      fecha: rangoTexto(d(r.inicio), d(r.fin)),
      cuenta: cuentaRegresiva(d(r.inicio), ref), pasada: d(r.fin) < ref
    });
  }

  for (const clave of ['publicacion', 'preparacion', 'evaluaciones', 'finales', 'reposicion']) {
    const h = hito(p, clave);
    if (!h) continue;
    const fi = d(h.inicio), ff = d(h.fin || h.inicio);
    tarjetas.push({
      clave, titulo: NOMBRE_HITO_CORTO[clave] || h.nombre,
      fecha: rangoTexto(fi, ff),
      cuenta: cuentaRegresiva(fi, ref),
      derivado: !!h.derivado,
      pasada: ff < ref
    });
  }

  let hayDerivados = false;
  for (const t of tarjetas) {
    const card = el('div', `clave k-${t.clave}${t.destacada ? ' destacada' : ''}${t.pasada ? ' pasada' : ''}`);
    card.append(el('h3', null, t.titulo));
    card.append(el('div', 'fecha', t.fecha));
    card.append(el('div', 'cuenta', t.cuenta));
    if (t.derivado) {
      hayDerivados = true;
      card.append(el('span', 'derivado', 'División referencial, no textual del calendario oficial'));
    }
    g.append(card);
  }

  // Nota de fuente
  const nota = $('#notaDerivados');
  nota.innerHTML = '';
  const partes = [];
  if (hayDerivados) {
    partes.push('El calendario oficial del TEC publica un único bloque «Evaluaciones y actividades finales». La separación entre semana de finales y semana de reposición/ampliación se muestra como referencia y puede editarse en Ajustes.');
  }
  if (p.semanasEsperadas && est.totalLectivas !== p.semanasEsperadas) {
    partes.push(`Nota: el rango publicado abarca ${est.totalLectivas} semanas de calendario y se esperaban ${p.semanasEsperadas} semanas lectivas; suele deberse a semanas parciales o a un receso no declarado. Puede ajustarlo en Ajustes.`);
  }
  partes.push(`Datos versión ${DATOS.version || '—'} (${DATOS.actualizado || 'sin fecha'}).`);
  nota.textContent = partes.join(' ');
}

function pintarSemanas(p) {
  const ref = hoy();
  const { semanas, totalLectivas } = construirSemanas(p);
  const cont = $('#listaSemanas');
  cont.innerHTML = '';

  for (const s of semanas) {
    const esActual = dentro(ref, s.ini, s.fin);
    const fila = el('div', `semana t-${s.tipo}${esActual ? ' actual' : ''}${s.fin < ref ? ' pasada' : ''}`);

    const num = el('div', 'sem-num');
    if (s.tipo === 'lectiva') {
      num.append(el('b', null, String(s.numero)));
      num.append(el('span', null, `de ${totalLectivas}`));
    } else if (s.tipo === 'receso') {
      num.append(el('b', null, '—'));
      num.append(el('span', null, 'receso'));
    } else if (s.tipo === 'preparacion') {
      num.append(el('b', null, '★'));
      num.append(el('span', null, 'prep.'));
    } else if (s.tipo === 'examenes') {
      num.append(el('b', null, '✎'));
      num.append(el('span', null, 'exám.'));
    } else {
      num.append(el('b', null, '·'));
      num.append(el('span', null, '—'));
    }
    fila.append(num);

    const info = el('div', 'sem-info');
    info.append(el('b', null, s.titulo));
    info.append(el('div', 'sem-rango', `${cap(fmtCorto.format(s.ini))} – ${cap(fmtCorto.format(s.fin))}`));
    if (s.marcas.length) {
      const extra = el('div', 'sem-extra');
      for (const m of s.marcas) extra.append(el('span', 'chip ' + m.tipo, m.texto));
      info.append(extra);
    }
    fila.append(info);

    if (esActual) fila.append(el('div', 'sem-badge', '← hoy'));
    cont.append(fila);
  }
}

function pintarCalendario(p) {
  const ref = hoy();
  const leyenda = $('#leyenda');
  leyenda.innerHTML = '';
  const items = [
    ['Lectiva', 'var(--c-lectiva-bg)'],
    ['No lectiva', 'var(--c-receso-bg)'],
    ['Preparación', 'var(--c-prep-bg)'],
    ['Evaluaciones', 'var(--c-examen-bg)'],
    ['Feriado', 'var(--c-feriado)'],
    ['Fecha máxima de actas', 'transparent']
  ];
  for (const [txt, color] of items) {
    const chip = el('span', 'chip');
    const marca = document.createElement('i');
    marca.style.background = color;
    if (txt === 'Fecha máxima de actas') marca.style.boxShadow = 'inset 0 0 0 2px var(--c-actas)';
    chip.append(marca, document.createTextNode(txt));
    leyenda.append(chip);
  }

  const cont = $('#meses');
  cont.innerHTML = '';
  const desde = d(p.lectivo.inicio), hasta = finPeriodo(p);
  let cursor = new Date(desde.getFullYear(), desde.getMonth(), 1, 12);
  let guarda = 0;

  while (cursor <= hasta && guarda++ < 24) {
    cont.append(tablaMes(p, cursor.getFullYear(), cursor.getMonth(), ref));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1, 12);
  }
}

function tablaMes(p, anio, mes, ref) {
  const caja = el('div', 'mes');
  caja.append(el('h3', null, cap(fmtMes.format(new Date(anio, mes, 1, 12)))));

  const tabla = document.createElement('table');
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  for (const dia of ['L', 'M', 'M', 'J', 'V', 'S', 'D']) trh.append(el('th', null, dia));
  thead.append(trh);
  tabla.append(thead);

  const tbody = document.createElement('tbody');
  const primero = new Date(anio, mes, 1, 12);
  const ultimo = new Date(anio, mes + 1, 0, 12);
  const offset = (primero.getDay() + 6) % 7;

  let tr = document.createElement('tr');
  for (let k = 0; k < offset; k++) tr.append(el('td', null, ''));

  for (let n = 1; n <= ultimo.getDate(); n++) {
    const fecha = new Date(anio, mes, n, 12);
    const td = document.createElement('td');
    const clases = claseDia(p, fecha);
    if (iso(fecha) === iso(ref)) clases.push('hoy');
    const caj = el('div', 'dia ' + clases.join(' '), String(n));
    const fer = feriadoEn(iso(fecha));
    const titulos = [];
    if (fer.length) titulos.push(...fer.map(f => f.nombre));
    if (clases.includes('actas')) titulos.push('Fecha máxima de entrega de actas');
    if (titulos.length) caj.title = titulos.join(' · ');
    td.append(caj);
    tr.append(td);
    if ((offset + n) % 7 === 0) { tbody.append(tr); tr = document.createElement('tr'); }
  }
  if (tr.children.length) {
    while (tr.children.length < 7) tr.append(el('td', null, ''));
    tbody.append(tr);
  }
  tabla.append(tbody);
  caja.append(tabla);
  return caja;
}

function pintarTodo() {
  const p = periodoPorId(SELECCION) || periodosOrdenados()[0];
  if (!p) return;
  SELECCION = p.id;
  localStorage.setItem(LS.periodo, p.id);
  pintarSelectores();
  pintarResumen(p);
  pintarSemanas(p);
  pintarCalendario(p);
  pintarMetaAjustes();
  $('#brandSub').textContent = p.nombre;
}

/* --------------------------------------------------------------- ajustes */

function pintarMetaAjustes() {
  $('#metaVersion').textContent = DATOS.version || '—';
  $('#metaActualizado').textContent = DATOS.actualizado || '—';
  $('#metaFuente').textContent = DATOS.fuente || '—';
  const rev = localStorage.getItem(LS.ultimaRev);
  $('#metaRevision').textContent = rev ? cap(fmtLargo.format(new Date(rev))) : 'nunca';

  const selEd = $('#selEditar');
  const previo = selEd.value;
  selEd.innerHTML = '';
  for (const p of periodosOrdenados()) {
    const o = el('option', null, p.nombre);
    o.value = p.id;
    selEd.append(o);
  }
  selEd.value = (EDITANDO && periodoPorId(EDITANDO)) ? EDITANDO : (previo || SELECCION);
  if (!selEd.value && selEd.options.length) selEd.selectedIndex = 0;
  EDITANDO = selEd.value;
}

function filaSub(tipo, datos = {}) {
  const fila = el('div', 'sub-item');
  fila.dataset.tipo = tipo;

  if (tipo === 'hito') {
    const lSel = el('label', null);
    lSel.append(document.createTextNode('Hito'));
    const s = document.createElement('select');
    s.name = 'clave';
    for (const [k, v] of Object.entries(NOMBRE_HITO_CORTO)) {
      const o = el('option', null, v); o.value = k; s.append(o);
    }
    const oOtro = el('option', null, 'Otro'); oOtro.value = 'otro'; s.append(oOtro);
    s.value = datos.clave && NOMBRE_HITO_CORTO[datos.clave] ? datos.clave : 'otro';
    lSel.append(s);
    fila.append(lSel);
  } else {
    const l = el('label', null);
    l.append(document.createTextNode('Nombre'));
    const inp = document.createElement('input');
    inp.name = 'nombre'; inp.value = datos.nombre || ''; inp.placeholder = 'Semana Santa';
    l.append(inp);
    fila.append(l);
  }

  for (const [campo, etiqueta] of [['inicio', 'Inicio'], ['fin', 'Fin']]) {
    const l = el('label', null);
    l.append(document.createTextNode(etiqueta));
    const inp = document.createElement('input');
    inp.type = 'date'; inp.name = campo; inp.value = datos[campo] || '';
    l.append(inp);
    fila.append(l);
  }

  const quitar = el('button', 'quitar', '✕');
  quitar.type = 'button';
  quitar.title = 'Quitar';
  quitar.addEventListener('click', () => fila.remove());
  fila.append(quitar);
  return fila;
}

function cargarFormulario(id) {
  const p = periodoPorId(id);
  const f = $('#formPeriodo');
  $('#listaRecesos').innerHTML = '';
  $('#listaHitos').innerHTML = '';
  $('#estadoForm').textContent = '';

  if (!p) {
    f.reset();
    return;
  }
  f.nombre.value = p.nombre || '';
  f.corto.value = p.corto || '';
  f.anio.value = p.anio || '';
  f.orden.value = p.orden || 1;
  f.tipo.value = p.tipo || 'semestre';
  f.semanasEsperadas.value = p.semanasEsperadas || '';
  f.lectivoInicio.value = p.lectivo.inicio;
  f.lectivoFin.value = p.lectivo.fin;

  for (const r of p.recesos || []) $('#listaRecesos').append(filaSub('receso', r));
  for (const h of p.hitos || []) $('#listaHitos').append(filaSub('hito', h));
}

function leerFormulario() {
  const f = $('#formPeriodo');
  const recesos = [...$('#listaRecesos').children].map(fila => ({
    nombre: fila.querySelector('[name="nombre"]').value.trim() || 'Semana no lectiva',
    inicio: fila.querySelector('[name="inicio"]').value,
    fin: fila.querySelector('[name="fin"]').value || fila.querySelector('[name="inicio"]').value
  })).filter(r => r.inicio);

  const hitos = [...$('#listaHitos').children].map(fila => {
    const clave = fila.querySelector('[name="clave"]').value;
    const anterior = (periodoPorId(EDITANDO)?.hitos || []).find(h => h.clave === clave);
    return {
      clave,
      nombre: NOMBRE_HITO_CORTO[clave] || anterior?.nombre || 'Hito',
      inicio: fila.querySelector('[name="inicio"]').value,
      fin: fila.querySelector('[name="fin"]').value || fila.querySelector('[name="inicio"]').value,
      ...(clave === 'finales' || clave === 'reposicion' ? { derivado: true } : {})
    };
  }).filter(h => h.inicio);

  const anio = Number(f.anio.value);
  const orden = Number(f.orden.value);
  return {
    id: (EDITANDO && periodoPorId(EDITANDO)) ? EDITANDO : `${anio}-${orden}`,
    anio, orden,
    tipo: f.tipo.value,
    nombre: f.nombre.value.trim(),
    corto: f.corto.value.trim(),
    semanasEsperadas: f.semanasEsperadas.value ? Number(f.semanasEsperadas.value) : undefined,
    lectivo: { inicio: f.lectivoInicio.value, fin: f.lectivoFin.value },
    recesos, hitos
  };
}

/* ---------------------------------------------------------- actualización */

function validarPaquete(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('El archivo no contiene un objeto JSON.');
  if (!Array.isArray(obj.periodos) || !obj.periodos.length) throw new Error('El archivo no trae la lista «periodos».');
  for (const p of obj.periodos) {
    if (!p.id || !p.nombre || !p.lectivo || !p.lectivo.inicio || !p.lectivo.fin) {
      throw new Error(`El periodo «${p.nombre || p.id || '?'}» está incompleto.`);
    }
  }
  if (!Array.isArray(obj.feriados)) obj.feriados = [];
  return obj;
}

async function buscarActualizaciones(silencioso = false) {
  const url = $('#urlRemota').value.trim();
  const estado = $('#estadoAct');
  const decir = (txt, clase = '') => { if (!silencioso || clase === 'ok') { estado.className = 'estado ' + clase; estado.textContent = txt; } };

  if (!url) { decir('Escriba primero la dirección del archivo de datos.', 'error'); return; }
  localStorage.setItem(LS.urlRemota, url);
  decir('Consultando…');

  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`El servidor respondió ${r.status}.`);
    const remoto = validarPaquete(await r.json());
    localStorage.setItem(LS.ultimaRev, new Date().toISOString());

    if (String(remoto.version || '') === String(DATOS.version || '') ) {
      decir(`Ya tiene la versión más reciente (${DATOS.version || 's/v'}).`, 'ok');
      pintarMetaAjustes();
      return;
    }
    const idsNuevos = remoto.periodos.map(p => p.id).filter(id => !periodoPorId(id));
    const resumen = idsNuevos.length
      ? `Agrega ${idsNuevos.length} periodo(s): ${idsNuevos.join(', ')}.`
      : 'Actualiza fechas de los periodos existentes.';
    const ok = confirm(
      `Hay una versión nueva del calendario.\n\n` +
      `Actual:  ${DATOS.version || 's/v'} (${DATOS.actualizado || '—'})\n` +
      `Nueva:   ${remoto.version || 's/v'} (${remoto.actualizado || '—'})\n\n` +
      `${resumen}\n\nEsto reemplaza los datos guardados en este dispositivo. ¿Aplicar?`
    );
    if (!ok) { decir('Actualización cancelada.'); return; }

    guardarDatos(remoto);
    if (!periodoPorId(SELECCION)) SELECCION = (periodoDeHoy(hoy()) || periodosOrdenados()[0]).id;
    pintarTodo();
    cargarFormulario(EDITANDO);
    decir(`Actualizado a la versión ${remoto.version || 's/v'}.`, 'ok');
  } catch (e) {
    decir('No se pudo actualizar: ' + e.message, 'error');
  }
}

/* ------------------------------------------------------------- interfaz */

function cambiarVista(nombre) {
  $$('.tab').forEach(t => t.classList.toggle('activa', t.dataset.vista === nombre));
  $$('.vista').forEach(v => v.classList.toggle('activa', v.id === 'vista-' + nombre));
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function aplicarTema(tema) {
  document.documentElement.dataset.tema = tema;
  localStorage.setItem(LS.tema, tema);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = tema === 'oscuro' ? '#0e131c' : '#0b3d91';
}

function conectarEventos() {
  $$('.tab').forEach(t => t.addEventListener('click', () => cambiarVista(t.dataset.vista)));

  $('#selAnio').addEventListener('change', () => {
    const anio = Number($('#selAnio').value);
    const primero = periodosOrdenados().find(p => p.anio === anio);
    if (primero) { SELECCION = primero.id; pintarTodo(); }
  });
  $('#selPeriodo').addEventListener('change', () => {
    SELECCION = $('#selPeriodo').value;
    pintarTodo();
  });
  $('#btnHoy').addEventListener('click', () => {
    const p = periodoDeHoy(hoy());
    if (p) { SELECCION = p.id; pintarTodo(); cambiarVista('resumen'); }
  });
  $('#btnTema').addEventListener('click', () => {
    aplicarTema(document.documentElement.dataset.tema === 'oscuro' ? 'claro' : 'oscuro');
  });

  // Actualización
  $('#btnBuscarAct').addEventListener('click', () => buscarActualizaciones(false));
  $('#autoActualizar').addEventListener('change', e => {
    localStorage.setItem(LS.autoAct, e.target.checked ? '1' : '0');
  });

  // Edición
  $('#selEditar').addEventListener('change', e => { EDITANDO = e.target.value; cargarFormulario(EDITANDO); });
  $('#btnAddReceso').addEventListener('click', () => $('#listaRecesos').append(filaSub('receso')));
  $('#btnAddHito').addEventListener('click', () => $('#listaHitos').append(filaSub('hito')));

  $('#btnNuevoPeriodo').addEventListener('click', () => {
    EDITANDO = null;
    $('#selEditar').value = '';
    cargarFormulario(null);
    const f = $('#formPeriodo');
    f.anio.value = new Date().getFullYear();
    f.orden.value = 1;
    f.semanasEsperadas.value = 16;
    for (const clave of ['preparacion', 'evaluaciones', 'actas']) {
      $('#listaHitos').append(filaSub('hito', { clave }));
    }
    $('#estadoForm').textContent = 'Complete los datos y guarde para crear el periodo.';
    f.nombre.focus();
  });

  $('#btnBorrarPeriodo').addEventListener('click', () => {
    const p = periodoPorId($('#selEditar').value);
    if (!p) return;
    if (DATOS.periodos.length <= 1) { alert('Debe quedar al menos un periodo.'); return; }
    if (!confirm(`¿Eliminar «${p.nombre}»? Solo afecta este dispositivo.`)) return;
    DATOS.periodos = DATOS.periodos.filter(x => x.id !== p.id);
    guardarDatos(DATOS);
    if (SELECCION === p.id) SELECCION = periodosOrdenados()[0].id;
    EDITANDO = null;
    pintarTodo();
    cargarFormulario($('#selEditar').value);
  });

  $('#formPeriodo').addEventListener('submit', e => {
    e.preventDefault();
    const estado = $('#estadoForm');
    try {
      const nuevo = leerFormulario();
      if (d(nuevo.lectivo.fin) < d(nuevo.lectivo.inicio)) throw new Error('El fin del periodo lectivo es anterior al inicio.');
      if (!EDITANDO && periodoPorId(nuevo.id)) {
        throw new Error(`Ya existe un periodo ${nuevo.anio} con orden ${nuevo.orden}. Cambie el año o el orden.`);
      }
      const idx = DATOS.periodos.findIndex(p => p.id === nuevo.id);
      if (idx >= 0) DATOS.periodos[idx] = nuevo; else DATOS.periodos.push(nuevo);
      DATOS.version = (DATOS.version || 'local') + '+editado';
      guardarDatos(DATOS);
      EDITANDO = nuevo.id;
      SELECCION = nuevo.id;
      pintarTodo();
      cargarFormulario(nuevo.id);
      estado.className = 'estado ok';
      estado.textContent = 'Periodo guardado.';
    } catch (err) {
      estado.className = 'estado error';
      estado.textContent = err.message;
    }
  });

  // Copia de seguridad
  $('#btnExportar').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(DATOS, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'calendario-tec.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  $('#btnImportar').addEventListener('click', () => $('#archivoImportar').click());
  $('#archivoImportar').addEventListener('change', async e => {
    const archivo = e.target.files[0];
    const estado = $('#estadoBackup');
    if (!archivo) return;
    try {
      const obj = validarPaquete(JSON.parse(await archivo.text()));
      guardarDatos(obj);
      SELECCION = (periodoDeHoy(hoy()) || periodosOrdenados()[0]).id;
      EDITANDO = SELECCION;
      pintarTodo();
      cargarFormulario(EDITANDO);
      estado.className = 'estado ok';
      estado.textContent = `Importado: ${obj.periodos.length} periodos (versión ${obj.version || 's/v'}).`;
    } catch (err) {
      estado.className = 'estado error';
      estado.textContent = 'Archivo inválido: ' + err.message;
    }
    e.target.value = '';
  });
  $('#btnRestaurar').addEventListener('click', async () => {
    if (!confirm('Se descartarán sus ediciones locales y se volverá al calendario que trae la app. ¿Continuar?')) return;
    localStorage.removeItem(LS.datos);
    location.reload();
  });
}

/* --------------------------------------------------------------- arranque */

async function iniciar() {
  aplicarTema(localStorage.getItem(LS.tema) ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro'));

  try {
    DATOS = validarPaquete(await cargarDatos());
  } catch (e) {
    document.querySelector('main').innerHTML =
      `<div class="panel"><h2>No se pudieron cargar los datos</h2><p class="ayuda">${e.message}</p></div>`;
    return;
  }

  const guardado = localStorage.getItem(LS.periodo);
  SELECCION = (guardado && periodoPorId(guardado)) ? guardado : (periodoDeHoy(hoy()) || periodosOrdenados()[0]).id;
  EDITANDO = SELECCION;

  $('#urlRemota').value = localStorage.getItem(LS.urlRemota) || '';
  $('#autoActualizar').checked = localStorage.getItem(LS.autoAct) === '1';
  if (DATOS.fuente) $('#enlaceFuente').href = DATOS.fuente;

  conectarEventos();
  pintarTodo();
  cargarFormulario(EDITANDO);

  if ($('#autoActualizar').checked && $('#urlRemota').value) {
    buscarActualizaciones(true);
  }
}

/* Service worker + instalación */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(() => { $('#estadoSW').textContent = 'Modo sin conexión activo.'; })
      .catch(err => { $('#estadoSW').textContent = 'Sin modo offline: ' + err.message; });
  });
} else {
  window.addEventListener('load', () => {
    const n = $('#estadoSW');
    if (n) n.textContent = 'Para instalar la app y usarla sin conexión debe abrirse por http(s), no como archivo local.';
  });
}

let promesaInstalar = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  promesaInstalar = e;
  const b = $('#btnInstalar');
  b.classList.remove('oculto');
  b.onclick = async () => {
    b.disabled = true;
    promesaInstalar.prompt();
    await promesaInstalar.userChoice;
    promesaInstalar = null;
    b.classList.add('oculto');
  };
});

iniciar();
