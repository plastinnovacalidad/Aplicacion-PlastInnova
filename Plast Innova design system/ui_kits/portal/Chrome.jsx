const { Icon, Button, IconButton, Input } = window.PlastInnovaDesignSystem_ff345a;

function AppHeader({ user, rol, onHome, onLogout, canGestion = true }) {
  return (
    <header style={{background:'var(--pi-gradient-blue)',color:'#fff',boxShadow:'var(--shadow-md)',flexShrink:0}}>
      <div style={{padding:'var(--space-5) var(--space-10)',display:'flex',alignItems:'center',justifyContent:'space-between',gap:'var(--space-8)'}}>
        <div style={{display:'flex',alignItems:'center',gap:'var(--space-4)',minWidth:0,cursor:'pointer'}} onClick={onHome}>
          <img src="../../assets/logo-horizontal-ng.png" alt="Plast Innova" style={{height:34,flexShrink:0}}/>
          <div style={{width:1,height:34,background:'rgba(255,255,255,.25)'}}/>
          <div style={{minWidth:0}}>
            <h1 style={{font:'var(--type-h3)',fontSize:'var(--fs-lg)',color:'#fff',whiteSpace:'nowrap'}}>Sistema de Calidad y Control</h1>
            <p style={{font:'var(--type-body-sm)',fontSize:'var(--fs-xs)',color:'rgba(255,255,255,.78)',margin:'2px 0 0',whiteSpace:'nowrap'}}>Plataforma centralizada · Circuitos SMD &amp; Garantías</p>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:'var(--space-4)'}}>
          <div style={{display:'flex',alignItems:'center',gap:'var(--space-3)',padding:'6px 6px 6px 14px',borderRadius:'var(--radius-pill)',background:'rgba(255,255,255,.12)'}}>
            <div style={{textAlign:'right',lineHeight:1.2}}>
              <div style={{font:'var(--type-label)',fontSize:'var(--fs-xs)',color:'#fff'}}>{user}</div>
              <div style={{font:'var(--type-body-sm)',fontSize:'var(--fs-2xs)',color:'rgba(255,255,255,.72)'}}>{rol}</div>
            </div>
            <div style={{width:30,height:30,borderRadius:'var(--radius-pill)',background:'rgba(255,255,255,.9)',color:'var(--pi-blue-700)',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <Icon name="user" size={15}/>
            </div>
          </div>
          {canGestion && <IconButton icon="gear" label="Gestión y permisos" style={{color:'#fff',background:'rgba(255,255,255,.12)'}}/>}
          <Button variant="ghost" size="sm" iconLeft="right-from-bracket" onClick={onLogout} style={{color:'#fff',background:'rgba(255,255,255,.12)'}}>Cerrar sesión</Button>
        </div>
      </div>
    </header>
  );
}

function Login({ onLogin }) {
  const [err,setErr] = React.useState('');
  return (
    <div style={{position:'absolute',inset:0,background:'var(--pi-gradient-blue)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:100,padding:'var(--space-6)'}}>
      <div style={{width:400,background:'#fff',borderRadius:'var(--radius-xl)',boxShadow:'var(--shadow-xl)',padding:'var(--space-10)'}}>
        <img src="../../assets/logo-horizontal.png" alt="Plast Innova" style={{height:42,display:'block',margin:'0 auto'}}/>
        <h2 style={{font:'var(--type-h2)',fontSize:'var(--fs-2xl)',textAlign:'center',marginTop:'var(--space-8)'}}>Bienvenido</h2>
        <p style={{font:'var(--type-body-sm)',color:'var(--text-muted)',textAlign:'center',margin:'var(--space-2) 0 var(--space-8)'}}>Sistema Integrado de Calidad y Circuitos</p>
        <div style={{display:'flex',flexDirection:'column',gap:'var(--space-4)'}}>
          <Input label="Usuario" iconLeft="user" placeholder="tu.usuario" defaultValue="j.ramirez"/>
          <Input label="Contraseña" iconLeft="lock" type="password" defaultValue="********"/>
          <Button variant="primary" size="lg" fullWidth iconRight="arrow-right" onClick={onLogin} style={{marginTop:'var(--space-2)'}}>Ingresar al sistema</Button>
          {err && <div style={{font:'var(--type-body-sm)',color:'var(--state-danger)',textAlign:'center'}}>{err}</div>}
        </div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8,marginTop:'var(--space-8)',font:'var(--type-body-sm)',fontSize:'var(--fs-xs)',color:'var(--text-muted)'}}>
          <Icon name="shield-halved" size={13}/> Acceso restringido a personal autorizado
        </div>
      </div>
    </div>
  );
}

Object.assign(window,{ AppHeader, Login });
