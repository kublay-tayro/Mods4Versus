# 🧟 Mods4Versus

<div align="center">


![Tauri](https://img.shields.io/badge/Tauri-v2-24C8D8?style=for-the-badge&logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Left 4 Dead 2](https://img.shields.io/badge/Left%204%20Dead%202-171A21?style=for-the-badge&logo=steam&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)

**Native Left 4 Dead 2 VPK Merger & Mod Manager**

*Play your favorite Workshop mods in Versus mode without file conflicts. Automatically merges VPKs and patches game configurations—no external tools needed.*

</div>

---
## 📸 Screenshots

<div align="center">
  <br>
  <img src="./assets/mods4versus-library.png" width="100%" alt="Mods4Versus Main Library View">
  <br><br>
  
  <p align="center">
    <img src="./assets/mods4versus-selecting.png" width="45%" alt="Mod Selection Interface">
    &nbsp; &nbsp;
    <img src="./assets/mods4versus-success.png" width="45%" alt="Successful Merge Notification">
  </p>
</div>
## 📥 Download

<div align="center">

| Version | Description | Link |
|---------|-------------|--------|
| **latest (v1.2.1)** | Auto-Updating Windows Setup | [⬇️ Download Installer](https://github.com/kublay-tayro/Mods4Versus/releases/download/v1.2.1/Mods4Versus_1.2.1_x64-setup.exe) |

</div>

---

## ✨ Key Features

- 🚀 **Native Performance** — Built with **Rust** and **Tauri v2** for minimal resource usage.
- 📦 **VPK Merging** — Combines multiple add-ons into a single optimized file to bypass server consistency checks.
- 🔄 **Auto-Configuration** — Automatically detects your L4D2 installation and patches the environment.
- ⚡ **Real-Time Streaming** — Instant visual feedback as mods are scanned and loaded.
- 🖼️ **Visual Preview** — View thumbnails and metadata for every mod before merging.

---

## 🎮 How to Use

1. **Launch** — The app automatically scans your Steam Workshop folder.
2. **Select** — Click on the mods you want to enable for Versus.
3. **Merge** — Hit the "MERGE" button.
4. **Play** — The tool places the merged VPK into your `mods/` folder and updates `gameinfo.txt`.

> 💡 **Note:** Mods4Versus handles the `gameinfo.txt` injection automatically. You do not need to edit any text files manually.

---

## 🔧 Tech Stack

| Component | Technology |
|------------|------------|
| Framework | [Tauri v2](https://v2.tauri.app/) |
| Core Logic | Rust |
| Frontend | HTML5, CSS3, JavaScript |
| VPK Parsing | Custom implementation + [valve_pak](https://crates.io/crates/valve_pak) |
| Path Detection | [steamlocate](https://crates.io/crates/steamlocate) |

---

## 📝 License

<div>

This project is open-source under the **GNU GPLv3** license. Contributions are welcome! 

Please read our [CONTRIBUTING.md](./CONTRIBUTING.md).

</div>

---

<div align="center">

*Crafted for the Left 4 Dead 2 Community*

</div>