import { App, Modal, Notice, Plugin, Setting, FileSystemAdapter, TFolder } from 'obsidian';
import * as path from 'path';
import { spawn } from 'child_process';
import * as fs from 'fs';
// @ts-ignore
import * as process from 'process';

// Define the plugin
export default class IdeaEmergencePlugin extends Plugin {

    configPath: string | null = null;

    async onload() {
        // Identify config path on load
        this.configPath = await Promise.resolve(this.getObsidianConfigPath());
        if (this.configPath) {
            console.debug(`Loading plugin. Configuration file found at: ${this.configPath}`);
            new Notice(`Obsidian Config found: ${this.configPath}`, 5000);
        } else {
            console.warn("Could not find any valid obsidian.json configuration file.");
            new Notice("Warning: Could not detect obsidian.json config file.", 5000);
        }

        // Register the command
        this.addCommand({
            id: 'open-directory-as-vault',
            name: 'Open directory as vault',
            callback: () => {
                void this.openDirectoryAsVault();
            }
        });

        // Register event for context menu
        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, file) => {
                if (file instanceof TFolder) {
                    menu.addItem((item) => {
                        item
                            .setTitle("Open as vault")
                            .setIcon("vault")
                            .onClick(() => {
                                void this.openFolderAsVault(file);
                            });
                    });
                }
            })
        );
    }

    getObsidianConfigPath(): string | null {
        // Method 1: Check Environment Variables (Most Robust)
        if (process.env.SNAP_USER_DATA) {
            const snapConfig = path.join(process.env.SNAP_USER_DATA, '.config', 'obsidian', 'obsidian.json');
            if (fs.existsSync(snapConfig)) return snapConfig;
        }

        // Method 2: Check XDG_CONFIG_HOME (Flatpak often uses this, or custom Linux setups)
        if (process.env.XDG_CONFIG_HOME) {
            const xdgConfig = path.join(process.env.XDG_CONFIG_HOME, 'obsidian', 'obsidian.json');
            if (fs.existsSync(xdgConfig)) return xdgConfig;
        }

        const homeDir = process.env.HOME || process.env.USERPROFILE || '';
        const possiblePaths = [
            // Check common sandboxed locations explicitly just in case env vars are missing
            path.join(homeDir, '.var', 'app', 'md.obsidian.Obsidian', 'config', 'obsidian', 'obsidian.json'), // Flatpak
            path.join(homeDir, 'snap', 'obsidian', 'current', '.config', 'obsidian', 'obsidian.json'), // Snap
            path.join(homeDir, '.config', 'obsidian', 'obsidian.json'), // Standard Linux/Mac
            path.join(process.env.APPDATA || '', 'Obsidian', 'obsidian.json') // Windows
        ];

        for (const configPath of possiblePaths) {
            if (fs.existsSync(configPath)) {
                return configPath;
            }
        }
        return null;
    }

    onunload() {

    }

    async openDirectoryAsVault() {
        await new Promise<void>((resolve) => {
            new PathModal(this.app, (result) => {
                if (result) {
                    void this.openPath(result);
                }
                resolve();
            }).open();
        });
    }


    async openFolderAsVault(folder: TFolder) {
        if (!(this.app.vault.adapter instanceof FileSystemAdapter)) {
            new Notice("This feature only works with a file system adapter.");
            return;
        }

        // Use getFullPath API for robust absolute path retrieval
        // @ts-ignore
        const absolutePath = this.app.vault.adapter.getFullPath(folder.path);
        await this.openPath(absolutePath);
    }

    async openPath(absolutePath: string) {
        // Step 1: Normalize and Prepare Path
        const normalizedPath = absolutePath.normalize('NFC');
        new Notice(`Processing vault: ${normalizedPath}`);

        const targetConfigPath = path.join(normalizedPath, this.app.vault.configDir);
        const isExistingVault = fs.existsSync(targetConfigPath);

        if (isExistingVault) {
            new Notice("Opening existing vault in new instance...");
            await Promise.resolve(this.spawnNewInstance(normalizedPath));
        } else {
            // Show plugin selection modal for new vaults
            await new Promise<void>((resolve) => {
                new PluginSelectionModal(this.app, async (selectedPlugins) => {
                    await this.initializeNewVault(normalizedPath, targetConfigPath, selectedPlugins);
                    resolve();
                }).open();
            });
        }
    }

    async initializeNewVault(normalizedPath: string, targetConfigPath: string, selectedPlugins: string[]) {
        // Step 2: Copy config directory
        // @ts-ignore
        const currentConfigPath = path.join(this.app.vault.adapter.getBasePath(), this.app.vault.configDir);
        if (fs.existsSync(currentConfigPath)) {
            new Notice("Configuring new vault...");
            try {
                await Promise.resolve(this.copyRecursiveSync(currentConfigPath, targetConfigPath));

                // Remove unselected plugins
                const targetPluginsPath = path.join(targetConfigPath, 'plugins');
                if (fs.existsSync(targetPluginsPath)) {
                    const installedPlugins = fs.readdirSync(targetPluginsPath);
                    for (const plugin of installedPlugins) {
                        if (!selectedPlugins.includes(plugin)) {
                            const pluginPath = path.join(targetPluginsPath, plugin);
                            // @ts-ignore
                            if (fs.rmSync) fs.rmSync(pluginPath, { recursive: true, force: true });
                            else fs.rmdirSync(pluginPath, { recursive: true }); // Fallback
                            console.debug(`Removed unselected plugin: ${plugin}`);
                        }
                    }
                }

            } catch (e) {
                console.error("Failed to copy config or filter plugins:", e);
                new Notice("Failed to configure plugins.");
            }
        }

        // Step 2.1: Automatically Trust & Enable Plugins (Disable Safe Mode)
        const targetAppJsonPath = path.join(targetConfigPath, 'app.json');
        try {
            let appConfig: Record<string, unknown> = {};
            if (fs.existsSync(targetAppJsonPath)) {
                const content = fs.readFileSync(targetAppJsonPath, 'utf8');
                try {
                    appConfig = JSON.parse(content) as Record<string, unknown>;
                } catch (parseError) {
                    console.error("Failed to parse existing app.json, creating new one.", parseError);
                }
            }

            // Disable Safe Mode to allow plugins to load
            appConfig.safeMode = false;

            await fs.promises.writeFile(targetAppJsonPath, JSON.stringify(appConfig, null, '\t'));
            console.debug("Safe Mode disabled in target vault.");
        } catch (e) {
            console.error("Failed to update app.json for Safe Mode:", e);
        }

        // Step 3: Update obsidian.json with new vault
        await Promise.resolve(this.addVaultToConfig(normalizedPath));

        // Step 5: Launch new obsidian app instance with saved path
        await Promise.resolve(this.spawnNewInstance(normalizedPath));

        // Step 4: Relaunch actual obsidian app (actual vault)
        setTimeout(() => {
            new Notice("Relaunching Obsidian...", 2000);
            this.relaunchApp();
        }, 1500);
    }

    spawnNewInstance(normalizedPath: string) {
        const encodedPath = encodeURIComponent(normalizedPath);
        const uri = `obsidian://open?path=${encodedPath}`;

        try {
            console.debug(`Spawning Obsidian with URI: ${uri}`);
            const child = spawn(process.execPath, [uri], {
                detached: true,
                stdio: 'ignore'
            });
            child.unref();
        } catch (error) {
            console.error("Failed to spawn Obsidian instance:", error);
            new Notice("Failed to launch new instance.");
        }
    }

    relaunchApp() {
        try {
            // Try to access electron app for relaunch
            // @ts-ignore
            const electron = window.require ? window.require('electron') : null;
            // Check for remote (Obsidian < 1.0 or with nodeIntegration)
            const app = electron?.remote ? electron.remote.app : undefined;

            if (app && app.relaunch) {
                app.relaunch();
                app.exit(0);
            } else {
                // Fallback if remote is not accessible (likely in newer Obsidian)
                // We can trying calling the Obsidian reload command,
                // or inform the user.
                console.debug("Electron remote not available. Falling back to reloading window.");
                // @ts-ignore
                this.app.commands.executeCommandById("app:reload");
            }
        } catch (e) {
            console.error("Relaunch failed:", e);
            // @ts-ignore
            this.app.commands.executeCommandById("app:reload");
        }
    }

    addVaultToConfig(vaultPath: string) {
        if (!this.configPath) {
            console.warn("No valid obsidian.json config file found earlier. Skipping config update.");
            return;
        }

        const configPath = this.configPath;

        try {
            console.debug(`Updating config at: ${configPath}`);
            const configContent = fs.readFileSync(configPath, 'utf8');
            const config = JSON.parse(configContent);

            if (config.vaults) {
                // Check if vault already exists
                const existingVaultId = Object.keys(config.vaults).find(key => {
                    const v = config.vaults[key];
                    return v.path === vaultPath;
                });

                if (!existingVaultId) {
                    // Generate random ID (16 chars HEXADECIMAL)
                    const generateId = () => {
                        let result = '';
                        const characters = '0123456789abcdef';
                        for (let i = 0; i < 16; i++) {
                            result += characters.charAt(Math.floor(Math.random() * 16));
                        }
                        return result;
                    };
                    const id = generateId();

                    config.vaults[id] = {
                        path: vaultPath,
                        ts: Date.now(),
                        open: true
                    };

                    fs.writeFileSync(configPath, JSON.stringify(config, null, '\t'));
                    console.debug(`Added vault to config: ${vaultPath} (ID: ${id}) at ${configPath}`);
                } else {
                    console.debug(`Vault already in config: ${vaultPath} (ID: ${existingVaultId}) at ${configPath}`);
                }
            }
        } catch (e) {
            console.error(`Error updating config at ${configPath}:`, e);
        }
    }

    copyRecursiveSync(src: string, dest: string) {
        const exists = fs.existsSync(src);
        const stats = exists ? fs.statSync(src) : null;
        const isDirectory = stats ? stats.isDirectory() : false;
        if (isDirectory) {
            if (!fs.existsSync(dest)) {
                fs.mkdirSync(dest);
            }
            fs.readdirSync(src).forEach((childItemName) => {
                this.copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
            });
        } else {
            fs.copyFileSync(src, dest);
        }
    }
}

class PathModal extends Modal {
    result: string = "";
    onSubmit: (result: string) => void;

    constructor(app: App, onSubmit: (result: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Enter vault path" });


        let defaultPath = "";
        if (this.app.vault.adapter instanceof FileSystemAdapter) {
            defaultPath = this.app.vault.adapter.getBasePath();
        }
        this.result = defaultPath;

        new Setting(contentEl)
            .setName("Directory path")
            .setDesc("Absolute path to the directory you want to open as a vault.")
            .addText((text) =>
                text
                    .setValue(defaultPath)
                    .onChange((value) => {
                        this.result = value;
                    })
                    .inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
                        if (e.key === "Enter") {
                            this.onSubmit(this.result);
                            this.close();
                        }
                    })
            );

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Open")
                    .setCta()
                    .onClick(() => {
                        this.onSubmit(this.result);
                        this.close();
                    }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class PluginSelectionModal extends Modal {
    plugins: string[] = [];
    selectedPlugins: Set<string> = new Set();
    pluginToggles: { setValue: (value: boolean) => void }[] = [];
    onConfirm: (selected: string[]) => void;

    constructor(app: App, onConfirm: (selected: string[]) => void) {
        super(app);
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Initialize new vault" });

        const warning = contentEl.createEl("div", { cls: "confirm-warning" });
        warning.setCssProps({
            "color": "var(--text-error)",
            "margin-bottom": "15px"
        });
        warning.createEl("p", { text: "This directory is not an obsidian vault. Initializing it will:" });
        const ul = warning.createEl("ul");
        ul.createEl("li", { text: "Copy config from current vault" });
        ul.createEl("li", { text: "Relaunch obsidian actual vault and new vault of directory selected" });
        ul.createEl("li", { text: "Don't forget to trust and enable plugins in new vault" });

        contentEl.createEl("h3", { text: "Select plugins to transfer" });

        // Load plugins
        // @ts-ignore
        const basePath = this.app.vault.adapter.getBasePath();
        const pluginsPath = path.join(basePath, this.app.vault.configDir, 'plugins');
        if (fs.existsSync(pluginsPath)) {
            try {
                this.plugins = fs.readdirSync(pluginsPath).filter(f => {
                    return fs.statSync(path.join(pluginsPath, f)).isDirectory();
                });
                // Default select all
                this.plugins.forEach(p => this.selectedPlugins.add(p));
            } catch (e) {
                console.error("Error reading plugins:", e);
                contentEl.createEl("p", { text: "Could not read plugins directory." });
            }
        }

        const listContainer = contentEl.createEl("div");
        listContainer.setCssProps({
            "max-height": "300px",
            "overflow-y": "auto",
            "margin-bottom": "20px",
            "border": "1px solid var(--background-modifier-border)",
            "padding": "10px"
        });

        if (this.plugins.length === 0) {
            listContainer.createEl("p", { text: "No plugins found." });
        } else {
            // Master Toggle
            new Setting(listContainer)
                .setName("Select all")
                .setDesc("Select or deselect all plugins")
                .addToggle(toggle => toggle
                    .setValue(true)
                    .onChange(value => {
                        this.selectedPlugins.clear();
                        if (value) {
                            this.plugins.forEach(p => this.selectedPlugins.add(p));
                        }
                        this.pluginToggles.forEach(t => t.setValue(value));
                    }));

            // Individual Toggles
            this.plugins.forEach(plugin => {
                new Setting(listContainer)
                    .setName(plugin)
                    .addToggle(toggle => {
                        this.pluginToggles.push(toggle);
                        toggle
                            .setValue(true)
                            .onChange(value => {
                                if (value) this.selectedPlugins.add(plugin);
                                else this.selectedPlugins.delete(plugin);
                            });
                    });
            });
        }

        const buttonContainer = contentEl.createEl("div");
        buttonContainer.setCssProps({
            "display": "flex",
            "justify-content": "flex-end",
            "gap": "10px"
        });

        new Setting(buttonContainer)
            .addButton((btn) =>
                btn
                    .setButtonText("Cancel")
                    .onClick(() => {
                        this.close();
                    }));

        new Setting(buttonContainer)
            .addButton((btn) =>
                btn
                    .setButtonText("Initialize vault")
                    .setCta()
                    .onClick(() => {
                        this.onConfirm(Array.from(this.selectedPlugins));
                        this.close();
                    }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
