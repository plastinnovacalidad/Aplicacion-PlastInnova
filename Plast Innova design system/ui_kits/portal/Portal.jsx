const { ModuleTile, Icon, Badge } = window.PlastInnovaDesignSystem_ff345a;

const SECCIONES = [
  { id:'electronica', titulo:'Electrónica', icono:'bolt', nota:'Captura y consulta de circuitos', modulos:[
    { icon:'bolt', label:'Módulo Circuitos SMD', tone:'var(--pi-gradient-blue)' },
    { icon:'plug', label:'Valores y Cableado', tone:'linear-gradient(135deg,#22272f 0%,#12151a 100%)' },
    { icon:'plus', label:'Crear Referencia', tone:'linear-gradient(135deg,#0f766e 0%,#115e59 100%)' },
  ]},
  { id:'piezas', titulo:'Piezas Plásticas', icono:'ruler-combined', nota:'Dimensional y planos de molde', modulos:[
    { icon:'ruler-combined', label:'Metrología y Planos de Molde', tone:'linear-gradient(135deg,#0071bc 0%,#005e9c 100%)' },
    { icon:'plus', label:'Crear Referencia (Planos)', tone:'linear-gradient(135deg,#0f766e 0%,#115e59 100%)' },
  ]},
  { id:'reportes', titulo:'Reportes', icono:'chart-column', nota:'Indicadores y consolidados', modulos:[
    { icon:'clipboard-list', label:'Tablero de Garantías', tone:'var(--pi-gradient-red)', view:'dashboard' },
  ]},
  { id:'calidad', titulo:'Calidad', icono:'award', nota:'Inspección, muestreo y garantías', modulos:[
    { icon:'award', label:'Calidad General', tone:'linear-gradient(135deg,#b7791f 0%,#975a16 100%)' },
    { icon:'file-arrow-up', label:'Cargar Garantías', tone:'var(--pi-gradient-red)' },
    { icon:'flask', label:'Muestreos ISO 2859-1', tone:'linear-gradient(135deg,#009245 0%,#00742f 100%)' },
  ]},
  { id:'whatsapp', titulo:'Bot WhatsApp', icono:'comment-dots', nota:'Registros recibidos por chat', modulos:[
    { icon:'whatsapp', label:'Control de Registros WhatsApp', tone:'linear-gradient(135deg,#25D366 0%,#128C7E 100%)' },
  ]},
];

function Portal({ onOpen }) {
  return (
    <div style={{maxWidth:1180,margin:'0 auto',padding:'var(--space-12) var(--space-8) var(--space-20)',width:'100%'}}>
      <div style={{textAlign:'center',marginBottom:'var(--space-12)'}}>
        <h2 style={{font:'var(--type-h2)'}}>Seleccione un módulo de trabajo</h2>
        <p style={{font:'var(--type-body)',color:'var(--text-muted)',marginTop:'var(--space-2)'}}>Solo se muestran los módulos habilitados para tu rol.</p>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:'var(--space-12)'}}>
        {SECCIONES.map(s=>(
          <section key={s.id}>
            <div style={{display:'flex',alignItems:'center',gap:'var(--space-4)',paddingBottom:'var(--space-4)',marginBottom:'var(--space-6)',borderBottom:'2px solid var(--border-subtle)'}}>
              <span style={{width:36,height:36,flex:'none',borderRadius:'var(--radius-md)',background:'var(--pi-blue-50)',color:'var(--pi-blue-600)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                <Icon name={s.icono} size={17}/>
              </span>
              <div style={{flex:1}}>
                <div style={{font:'var(--type-eyebrow)',letterSpacing:'var(--ls-widest)',textTransform:'uppercase',color:'var(--text-heading)',fontSize:'var(--fs-sm)'}}>{s.titulo}</div>
                <div style={{font:'var(--type-body-sm)',fontSize:'var(--fs-xs)',color:'var(--text-muted)',marginTop:2}}>{s.nota}</div>
              </div>
              <Badge tone="neutral">{s.modulos.length} {s.modulos.length===1?'módulo':'módulos'}</Badge>
            </div>
            <div style={{display:'flex',flexWrap:'wrap',gap:'var(--space-5)'}}>
              {s.modulos.map(m=>(
                <ModuleTile key={m.label} icon={m.icon} label={m.label} tone={m.tone} size={150}
                  onClick={()=>m.view&&onOpen(m.view)}/>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
Object.assign(window,{ Portal });
