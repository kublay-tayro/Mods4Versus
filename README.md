# 🧟 Mods4Versus

<div align="center">

![Tauri](https://img.shields.io/badge/Tauri-v2-24C8D8?style=for-the-badge&logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)
![Left 4 Dead 2](https://img.shields.io/badge/Left%204%20Dead%202-171A21?style=for-the-badge&logo=steam&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)

**Un gestor de mods nativo para Left 4 Dead 2**

*Fusiona múltiples mods del Workshop en uno solo con un clic*

</div>

---

## ✨ Características

- 🚀 **Rendimiento Nativo** — Construido con Rust y Tauri v2
- 🔄 **Auto-Reparación** — Configura automáticamente el entorno del juego al iniciar
- 📦 **Fusión de Mods** — Combina múltiples VPKs en un solo archivo optimizado
- 🖼️ **Vista Previa** — Muestra miniaturas e información de cada mod
- ⚡ **Streaming en Tiempo Real** — Los mods aparecen instantáneamente mientras se escanean

---

## 📸 Capturas

<div align="center">

*Próximamente...*

</div>

---

## 🛠️ Instalación

### Requisitos Previos

- [Rust](https://rustup.rs/) (estable)
- [Node.js](https://nodejs.org/) (v18+)
- Left 4 Dead 2 

## 🎮 Uso

1. **Iniciar la aplicación** — Los mods del Workshop se escanean automáticamente
2. **Seleccionar mods** — Haz clic para seleccionar los mods a fusionar
3. **Fusionar** — Presiona el botón "FUSIONAR" para combinarlos
4. **¡Listo!** — El VPK fusionado se coloca en la carpeta `mods/` del juego. Ya se puede jugar.

> 💡 **Tip:** La aplicación inyecta automáticamente la ruta `Game mods` en `gameinfo.txt`, así que no necesitas configurar nada manualmente.

---

## 🔧 Stack Tecnológico

| Componente | Tecnología |
|------------|------------|
| Framework | [Tauri v2](https://v2.tauri.app/) |
| Backend | Rust |
| Frontend | HTML5 / CSS3 / JavaScript |
| Parsing VPK | Implementación propia + [valve_pak](https://crates.io/crates/valve_pak) |
| Detección Steam | [steamlocate](https://crates.io/crates/steamlocate) |

---

## 📝 Licencia y Contribuciones
<div>

Este proyecto es de código abierto bajo la licencia GNU GPLv3. Para más detalles sobre cómo colaborar, consulta nuestra Guía de Contribución.

</div>

## 👤 Autor

**Kublay**

---

<div align="center">

*Hecho a base de F1 y Baje de Pepa para la comunidad de Left 4 Dead 2*

</div>
