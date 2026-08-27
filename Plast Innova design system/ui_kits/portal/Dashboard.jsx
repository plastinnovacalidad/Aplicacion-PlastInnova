const { KpiCard, DataTable, ChartPanel, CHART_COLORS, Badge, Button, Select, Tabs, Breadcrumb, Icon, Tag } = window.PlastInnovaDesignSystem_ff345a;

const FILAS = [
  { fecha:'26/08/2026', ref:'0111-Am-Mul-V4', lote:'20260824', cant:1200, aql:'1,0', defectos:3, estado:'Aceptado', insp:'J. Ramírez' },
  { fecha:'26/08/2026', ref:'TAR-1001P-AB-Mul', lote:'20260825', cant:800, aql:'2,5', defectos:14, estado:'Rechazado', insp:'L. Cardona' },
  { fecha:'25/08/2026', ref:'Cir-1005-V4', lote:'20260826', cant:2400, aql:'1,0', defectos:5, estado:'Aceptado', insp:'J. Ramírez' },
  { fecha:'25/08/2026', ref:'0111-Ro-Sim-V2', lote:'20260819', cant:600, aql:'1,0', defectos:1, estado:'Aceptado', insp:'M. Ospina' },
  { fecha:'24/08/2026', ref:'TAR-2003-CD-Mul', lote:'20260818', cant:1500, aql:'4,0', defectos:22, estado:'Rechazado', insp:'L. Cardona' },
  { fecha:'24/08/2026', ref:'Cir-1010-V1', lote:'20260817', cant:950, aql:'2,5', defectos:6, estado:'Aceptado', insp:'M. Ospina' },
  { fecha:'23/08/2026', ref:'0111-Am-Mul-V3', lote:'20260814', cant:1200, aql:'1,0', defectos:2, estado:'Aceptado', insp:'J. Ramírez' },
];

const COLS = [
  { key:'fecha', label:'Fecha', width:100 },
  { key:'ref', label:'Referencia' },
  { key:'lote', label:'Lote', width:110 },
  { key:'cant', label:'Cantidad', align:'right', width:90, render:v=>v.toLocaleString('es-CO') },
  { key:'aql', label:'AQL', align:'right', width:70 },
  { key:'defectos', label:'Defectos', align:'right', width:90 },
  { key:'estado', label:'Resultado', width:130, render:v=><Badge tone={v==='Aceptado'?'success':'accent'} solid={v!=='Aceptado'} icon={v==='Aceptado'?'check':'xmark'}>{v}</Badge> },
  { key:'insp', label:'Inspector', width:130 },
];

function Bars({ data, labels }) {
  const max = Math.max(...data);
  return (
    <div style={{display:'flex',alignItems:'flex-end',gap:10,height:'100%'}}>
      {data.map((v,i)=>(
        <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:6,height:'100%',justifyContent:'flex-end'}}>
          <span style={{font:'var(--type-data)',fontSize:'var(--fs-2xs)',color:'var(--text-muted)'}}>{v}</span>
          <div style={{width:'100%',height:(v/max*100)+'%',background:'var(--pi-blue-600)',borderRadius:'4px 4px 0 0'}}/>
          <span style={{font:'var(--type-data)',fontSize:'var(--fs-2xs)',color:'var(--text-muted)'}}>{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

function Donut({ slices }) {
  const total = slices.reduce((a,s)=>a+s.v,0);
  let acc = 0;
  const stops = slices.map((s,i)=>{const from=acc/total*360;acc+=s.v;const to=acc/total*360;return `${s.c} ${from}deg ${to}deg`;}).join(',');
  return (
    <div style={{display:'flex',alignItems:'center',gap:'var(--space-8)',height:'100%'}}>
      <div style={{width:150,height:150,flex:'none',borderRadius:'50%',background:`conic-gradient(${stops})`,position:'relative'}}>
        <div style={{position:'absolute',inset:38,borderRadius:'50%',background:'#fff',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}>
          <span style={{font:'var(--type-data-strong)',fontSize:'var(--fs-xl)',color:'var(--text-heading)'}}>{total}</span>
          <span style={{font:'var(--type-body-sm)',fontSize:'var(--fs-2xs)',color:'var(--text-muted)'}}>lotes</span>
        </div>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:'var(--space-3)'}}>
        {slices.map(s=>(
          <div key={s.l} style={{display:'flex',alignItems:'center',gap:10}}>
            <span style={{width:11,height:11,borderRadius:3,background:s.c,flex:'none'}}/>
            <span style={{font:'var(--type-data)',color:'var(--text-body)',minWidth:120}}>{s.l}</span>
            <span style={{font:'var(--type-data-strong)',color:'var(--text-heading)'}}>{Math.round(s.v/total*100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Dashboard({ onHome }) {
  const [periodo,setPeriodo] = React.useState('Mes');
  return (
    <div style={{maxWidth:1400,margin:'0 auto',padding:'var(--space-8) var(--space-8) var(--space-20)',width:'100%'}}>
      <Breadcrumb items={['Portal','Reportes','Tablero de Garantías']}/>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',gap:'var(--space-8)',marginTop:'var(--space-4)'}}>
        <div>
          <h1 style={{font:'var(--type-h1)',fontSize:'var(--fs-4xl)'}}>Tablero de Garantías</h1>
          <p style={{font:'var(--type-body)',color:'var(--text-muted)',marginTop:'var(--space-2)'}}>Consolidado de inspecciones y garantías · actualizado hoy 08:40</p>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:'var(--space-3)'}}>
          <Tabs variant="pill" items={['Semana','Mes','Año']} value={periodo} onChange={setPeriodo}/>
          <Button variant="secondary" iconLeft="file-pdf">Exportar PDF</Button>
          <Button variant="primary" iconLeft="rotate-right">Actualizar</Button>
        </div>
      </div>

      <div style={{display:'flex',alignItems:'center',gap:'var(--space-3)',marginTop:'var(--space-8)',flexWrap:'wrap'}}>
        <span style={{font:'var(--type-label)',color:'var(--text-muted)'}}>Filtros</span>
        <Select options={['Todas las líneas','Circuitos SMD','Piezas plásticas']} size="sm" wrapperStyle={{width:200}}/>
        <Select options={['Todos los inspectores','J. Ramírez','L. Cardona','M. Ospina']} size="sm" wrapperStyle={{width:210}}/>
        <Tag selected onRemove={()=>{}}>Agosto 2026</Tag>
        <Tag onRemove={()=>{}}>AQL 1,0</Tag>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'var(--space-5)',marginTop:'var(--space-6)'}}>
        <KpiCard label="Lotes inspeccionados" value="1.284" icon="clipboard-list" delta={12} deltaLabel="vs. mes anterior"/>
        <KpiCard label="Lotes aceptados" value="1.096" icon="circle-check" tone="success" delta={4} deltaLabel="vs. mes anterior"/>
        <KpiCard label="Lotes rechazados" value="188" icon="circle-xmark" tone="accent" delta={-7} deltaLabel="vs. mes anterior"/>
        <KpiCard label="Tasa de rechazo" value="14,6" unit="%" icon="gauge-high" tone="info"/>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1.35fr 1fr',gap:'var(--space-5)',marginTop:'var(--space-5)'}}>
        <ChartPanel title="Lotes inspeccionados por mes" subtitle="Últimos 8 meses" height={230}
          action={<Select options={['2026','2025']} size="sm" wrapperStyle={{width:110}}/>}>
          <Bars data={[86,102,94,131,118,146,139,168]} labels={['ene','feb','mar','abr','may','jun','jul','ago']}/>
        </ChartPanel>
        <ChartPanel title="Motivo de rechazo" subtitle="Agosto 2026" height={230}>
          <Donut slices={[
            {l:'Soldadura fría',v:64,c:CHART_COLORS[0]},
            {l:'Componente ausente',v:48,c:CHART_COLORS[1]},
            {l:'Dimensional',v:41,c:CHART_COLORS[2]},
            {l:'Cableado',v:35,c:CHART_COLORS[3]},
          ]}/>
        </ChartPanel>
      </div>

      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginTop:'var(--space-10)',marginBottom:'var(--space-5)'}}>
        <div>
          <div style={{font:'var(--type-eyebrow)',letterSpacing:'var(--ls-widest)',textTransform:'uppercase',color:'var(--pi-red-700)'}}>Detalle</div>
          <h2 style={{font:'var(--type-h2)',fontSize:'var(--fs-2xl)',marginTop:'var(--space-2)'}}>Últimas inspecciones</h2>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:'var(--space-3)'}}>
          <span style={{font:'var(--type-data)',fontSize:'var(--fs-xs)',color:'var(--text-muted)'}}>Mostrando 7 de 1.284</span>
          <Button variant="ghost" size="sm" iconRight="arrow-right">Ver todas</Button>
        </div>
      </div>
      <DataTable columns={COLS} rows={FILAS}/>
    </div>
  );
}
Object.assign(window,{ Dashboard });
