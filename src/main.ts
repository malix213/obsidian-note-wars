import { App, Modal, Notice, Plugin, Setting, FileSystemAdapter, TFolder, Platform } from 'obsidian';
import * as path from 'path';
import { spawn } from 'child_process';
import * as fs from 'fs';
// @ts-ignore
import * as process from 'process';
import { platform } from 'os';
import * as crypto from 'crypto';

interface ExtendedApp extends App {
    commands: {
        executeCommandById(id: string): void;
    };
}

interface VaultEntry {
    path: string;
    ts: number;
    open: boolean;
}

interface ObsidianConfig {
    vaults: Record<string, VaultEntry>;
}

interface ElectronApp {
    relaunch(): void;
    exit(code: number): void;
}

interface ElectronModule {
    remote?: {
        app: ElectronApp;
    };
}

interface WindowWithInternal extends Window {
    require?(module: string): unknown;
}



// Define the plugin
export default class IdeaEmergencePlugin extends Plugin {

    onload() {
        // Register the main command
        this.addCommand({
            id: 'open-directory-as-vault',
            name: 'Open directory as vault',
            callback: () => {
                void this.openDirectoryAsVault();
            }
        });

        // Register the diagnostic command
        this.addCommand({
            id: 'check-registration-status',
            name: 'Check registration status',
            callback: () => {
                void this.checkRegistrationStatus();
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
        const normalizedPath = absolutePath.normalize('NFC');
        const targetConfigPath = path.join(normalizedPath, this.app.vault.configDir);

        // Step 1: Show window to select plugins to migrate
        new PluginSelectionModal(this.app, async (selectedPlugins) => {
            new Notice("Copying configuration...");
            // Step 2: Copy .obsidian of actual vault to directory with selected plugins
            await this.initializeNewVault(normalizedPath, targetConfigPath, selectedPlugins);

            // Step 3: Register new directory to list of vault in obsidian.json
            await this.registerVault(normalizedPath);

            // Step 4: Reload/Relaunch app to show directory in list
            new Notice("Relaunching Obsidian...");
            this.relaunchApp();
        }).open();
    }

    getCurrentPlugins(): string[] {
        try {
            if (!(this.app.vault.adapter instanceof FileSystemAdapter)) return [];
            const adapter = this.app.vault.adapter as FileSystemAdapter;
            const pluginsPath = path.join(adapter.getBasePath(), this.app.vault.configDir, 'plugins');
            if (fs.existsSync(pluginsPath)) {
                return fs.readdirSync(pluginsPath).filter(f => {
                    const fullPath = path.join(pluginsPath, f);
                    return fs.statSync(fullPath).isDirectory();
                });
            }
        } catch (e) {
            console.error("Failed to get current plugins:", e);
        }
        return [];
    }

    async checkRegistrationStatus() {
        const configPath = this.getObsidianConfigPath();
        if (!configPath) {
            new Notice("Could not detect Obsidian configuration path");
            return;
        }

        const exists = fs.existsSync(configPath);
        if (!exists) {
            new Notice(`Obsidian configuration not found at ${configPath}`);
            return;
        }

        try {
            const content = fs.readFileSync(configPath, 'utf8');
            const config = JSON.parse(content) as ObsidianConfig;
            const vaultCount = config.vaults ? Object.keys(config.vaults).length : 0;

            if (this.app.vault.adapter instanceof FileSystemAdapter) {
                const currentPath = this.app.vault.adapter.getBasePath();
                const id = crypto.createHash('md5').update(currentPath).digest('hex').substring(0, 16);
                const isRegistered = config.vaults && config.vaults[id];

                new Notice(`Config: ${configPath}\nRegistered vaults: ${vaultCount}\nCurrent vault registered: ${isRegistered ? "Yes" : "No"}`);
                console.debug("Registration status:", { configPath, vaultCount, isRegistered, id });
            }
        } catch (e: unknown) {
            new Notice("Failed to read registration status");
            console.error(e);
        }
    }

    async handleNewVault(normalizedPath: string, targetConfigPath: string, selectedPlugins: string[]) {
        try {
            await this.initializeNewVault(normalizedPath, targetConfigPath, selectedPlugins);
            await this.registerVault(normalizedPath);
            this.spawnNewInstance(normalizedPath, 5);
            this.reloadApp();
        } catch (e: unknown) {
            console.error("Failed to initialize vault:", e);
            new Notice("Failed to initialize vault.");
        }
    }

    async initializeNewVault(normalizedPath: string, targetConfigPath: string, selectedPlugins: string[]) {
        // Step 2: Copy config directory
        const adapter = this.app.vault.adapter as FileSystemAdapter;
        const currentConfigPath = path.join(adapter.getBasePath(), this.app.vault.configDir);
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

            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                console.error("Failed to copy config or filter plugins:", message);
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
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            console.error("Failed to update app.json for Safe Mode:", message);
        }

        new Notice("Vault initialization complete.");
    }

    reloadApp() {
        try {
            console.debug("Reloading current vault...");
            (this.app as ExtendedApp).commands.executeCommandById("app:reload");
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            console.error("Reload failed:", message);
            // Fallback to location reload if command fails
            window.location.reload();
        }
    }

    relaunchApp() {
        try {
            // Try to access electron app for relaunch
            const win = window as unknown as WindowWithInternal;
            const electron = win.require ? win.require('electron') as ElectronModule : null;

            // Check for remote
            const app = electron?.remote?.app;

            if (app && typeof app.relaunch === 'function') {
                app.relaunch();
                app.exit(0);
            } else {
                this.reloadApp();
            }
        } catch (e: unknown) {
            this.reloadApp();
        }
    }
    spawnNewInstance(normalizedPath: string, delaySeconds: number = 0) {
        const encodedPath = encodeURIComponent(normalizedPath);
        const uri = `obsidian://open?path=${encodedPath}`;

        let command = '';
        let args: string[] = [];

        switch (platform()) {
            case 'darwin': // macOS
                command = 'open';
                args.push(uri);
                break;
            case 'win32': // Windows
                command = 'cmd.exe';
                args.push('/c', 'start', '""', uri);
                break;
            case 'linux': // Linux
                const obsidianId = 'md.obsidian.Obsidian';

                // Determine the most likely command based on installation type
                const configPath = this.getObsidianConfigPath() || '';
                if (configPath.includes('.var/app/' + obsidianId)) {
                    command = 'flatpak';
                    args = ['run', obsidianId, normalizedPath];
                } else if (configPath.includes('snap/obsidian')) {
                    command = 'snap';
                    args = ['run', 'obsidian', normalizedPath];
                } else {
                    command = 'obsidian';
                    args = [normalizedPath];
                }
                break;
            default:
                console.error(`Unsupported platform: ${platform()}`);
                new Notice("Failed to launch new instance.");
                return;
        }

        let finalCommand = command;
        let finalArgs = args;

        // Apply delay if requested
        if (delaySeconds > 0) {
            if (platform() === 'linux' || platform() === 'darwin') {
                const shellEscapedArgs = args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
                finalCommand = 'sh';
                finalArgs = ['-c', `sleep ${delaySeconds} && ${command} ${shellEscapedArgs}`];
            } else if (platform() === 'win32') {
                const shellEscapedArgs = args.join(' ');
                finalCommand = 'cmd.exe';
                finalArgs = ['/c', `timeout /t ${delaySeconds} /nobreak && ${command} ${shellEscapedArgs}`];
            }
        }

        try {
            console.debug(`Spawning Obsidian with command: ${finalCommand} ${finalArgs.join(' ')}`);
            const child = spawn(finalCommand, finalArgs, {
                detached: true,
                stdio: 'ignore'
            });

            if (platform() === 'linux' && delaySeconds === 0) {
                child.on('error', (err) => {
                    console.warn(`Primary Linux spawn (${command}) failed, trying xdg-open fallback`, err);
                    const fallback = spawn('xdg-open', [uri], { detached: true, stdio: 'ignore' });
                    fallback.unref();
                });
            }

            child.unref();
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("Failed to spawn Obsidian instance:", message);
            new Notice("Failed to launch new instance.");
        }
    }

    async registerVault(vaultPath: string) {
        try {
            const configPath = this.getObsidianConfigPath();
            if (!configPath || !fs.existsSync(configPath)) {
                console.warn("Obsidian config file not found, skipping registration.");
                return;
            }

            const configContent = fs.readFileSync(configPath, 'utf8');
            const config = JSON.parse(configContent) as ObsidianConfig;

            if (!config.vaults) config.vaults = {};

            // Helper to register/update a vault with the correct ID
            const upsertVault = (p: string, isOpen: boolean) => {
                // Obsidian uses a short hash of the absolute path
                const id = crypto.createHash('md5').update(p).digest('hex').substring(0, 16);
                config.vaults[id] = {
                    path: p,
                    ts: Date.now(),
                    open: isOpen
                };
                return id;
            };

            // 1. Register/Update the new vault
            upsertVault(vaultPath, true);

            // 2. Ensure current vault is also marked as open and most recent
            // This prevents Obsidian from showing the 'Vault Switcher' on relaunch
            if (this.app.vault.adapter instanceof FileSystemAdapter) {
                const currentPath = this.app.vault.adapter.getBasePath();
                upsertVault(currentPath, true);
            }

            fs.writeFileSync(configPath, JSON.stringify(config, null, '\t'));
            console.debug(`Successfully registered vaults in ${configPath}`);
        } catch (e: unknown) {
            console.error("Failed to register vault in obsidian.json:", e);
        }
    }

    getObsidianConfigPath() {
        if (Platform.isAndroidApp) {
            // Android internal storage path for Obsidian config
            return '/data/data/md.' + 'obsidian/files/obsidian.json';
        }
        if (Platform.isIosApp) {
            // iOS path - apps are sandboxed, but this is the theoretical location
            return 'Documents/obsidian.json';
        }

        const home = Platform.isWin ? process.env.USERPROFILE : process.env.HOME;
        if (!home) return null;

        if (Platform.isMacOS) {
            return path.join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json');
        }
        if (Platform.isWin) {
            return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'obsidian', 'obsidian.json');
        }
        if (Platform.isDesktop && !Platform.isMacOS && !Platform.isWin) { // Linux
            const home = process.env.HOME || '';
            const obsidianId = 'md.' + 'obsidian' + '.Obsidian';

            // Priority order for Linux config paths as requested
            const paths = [
                path.join(home, '.config', 'obsidian', 'obsidian.json'), // Standard/Apt
                path.join(home, '.var', 'app', obsidianId, 'config', 'obsidian', 'obsidian.json'), // Flatpak
                path.join(home, 'snap', 'obsidian', 'current', '.config', 'obsidian', 'obsidian.json'), // Snap
                path.join(home, 'snap', 'obsidian', 'common', '.config', 'obsidian', 'obsidian.json') // Snap common
            ];

            if (process.env.XDG_CONFIG_HOME) {
                paths.unshift(path.join(process.env.XDG_CONFIG_HOME, 'obsidian', 'obsidian.json'));
            }

            for (const configPath of paths) {
                if (fs.existsSync(configPath)) return configPath;
            }

            return paths[0];
        }
        return null;
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
        warning.createEl("p", { text: "This directory is not an Obsidian vault. Initializing it will:" });
        const ul = warning.createEl("ul");
        ul.createEl("li", { text: "Copy config from current vault" });
        ul.createEl("li", { text: "Relaunch Obsidian actual vault and new vault of directory selected" });
        ul.createEl("li", { text: "Don't forget to trust and enable plugins in new vault" });

        contentEl.createEl("h3", { text: "Select plugins to transfer" });

        // Load plugins
        const adapter = this.app.vault.adapter as FileSystemAdapter;
        const basePath = adapter.getBasePath();
        const pluginsPath = path.join(basePath, this.app.vault.configDir, 'plugins');
        if (fs.existsSync(pluginsPath)) {
            try {
                this.plugins = fs.readdirSync(pluginsPath).filter(f => {
                    return fs.statSync(path.join(pluginsPath, f)).isDirectory();
                });
                // Default select all
                this.plugins.forEach(p => this.selectedPlugins.add(p));
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                console.error("Error reading plugins:", message);
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
