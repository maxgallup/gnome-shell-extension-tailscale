const { St, Clutter } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Extension = imports.misc.extensionUtils.getCurrentExtension();
const Util = imports.misc.util;


const Main = imports.ui.main;
const GObject = imports.gi.GObject;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const Me = imports.misc.extensionUtils.getCurrentExtension();

const statusString = "Status: ";
const enabledString = "🟢";
const disabledString = "⚫";
const ownConnectionString = "💻";

class TailscaleNode {
    constructor(_name, _address, _online, _offersExit, _usesExit, _isSelf) {
        this.name = _name;
        this.address = _address;
        this.online = _online;
        this.offersExit = _offersExit;
        this.usesExit = _usesExit;
        this.isSelf = _isSelf;
    }

    get line() {
        var statusIcon;
        if (this.isSelf) {
            statusIcon = ownConnectionString;
        } else if (this.online) {
            statusIcon = enabledString;
        } else {
            statusIcon = disabledString;
        }
        return statusIcon + " " + this.address + " " + this.name;
    }
}

let nodes = [];
let accounts = [];
let currentAccount = "(click Update Accounts List)";

let nodesMenu;
let accountButton;
let accountsMenu;
let accountIndicator;
let logoutButton;
let exitNodeMenu;
let sendMenu;
let statusItem;
let authItem;
let needToAuth = true;
let authUrl;

let health;

let receiveFilesItem
let shieldItem;
let acceptRoutesItem;
let allowLanItem;
let statusSwitchItem;
let downloads_path = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD);
let icon;
let icon_down;
let icon_up;
let icon_exit_node;
let SETTINGS;

let timerId = null;


function myWarn(string) {
    log("🟡 [tailscale-status]: " + string);
}

function myError(string) {
    log("🔴 [tailscale-status]: " + string);
}


function extractNodeInfo(json) {
    nodes = [];

    var me = json.Self;
    if (me.TailscaleIPs != null) {
        nodes.push(new TailscaleNode(
            me.DNSName.split(".")[0],
            me.TailscaleIPs[0],
            me.Online,
            me.ExitNodeOption,
            me.ExitNode,
            true
        )
        );
    }
    for (let p in json.Peer) {
        var n = json.Peer[p];
        if (n.TailscaleIPs != null) {
            nodes.push(new TailscaleNode(
                n.DNSName.split(".")[0],
                n.TailscaleIPs[0],
                n.Online,
                n.ExitNodeOption,
                n.ExitNode,
                false
            ));
        }

    }
    nodes.sort(sortNodes)
}

function sortNodes(a, b) {
    if (a.isSelf == true && b.isSelf == false) {
        return -1;
    }

    if (a.online == true && b.online == true) {
        return 0;
    } else if (a.online == true && b.online == false) {
        return -1;
    } else if (a.online == false && b.online == true) {
        return 1;
    } else if (a.online == false && b.online == false) {
        return 0;
    }
}
function getUsername(json) {
    let id = 0
    if (json.Self.UserID != null) {
        id = json.Self.UserID
    }
    if (json.User != null) {
        for (const [key, value] of Object.entries(json.User)) {
            if (value.ID === id) {
                return value.LoginName
            }
        }
    }
    return json.Self.HostName
}
function setStatus(json) {
    authItem.label.text = "Logged in: " + getUsername(json);
    accountIndicator.label.text = "Account: " + currentAccount;
    authItem.sensitive = false;
    health = json.Health
    switch (json.BackendState) {
        case "Running":
            needToAuth = true
            icon.gicon = icon_up;
            statusSwitchItem.setToggleState(true);
            statusItem.label.text = statusString + "up (no exit-node)";
            nodes.forEach((node) => {
                if (node.usesExit) {
                    statusItem.label.text = statusString + "up (exit-node: " + node.name + ")";
                    icon.gicon = icon_exit_node;
                }
            })
            setAllItems(true);
            break;
        case "Stopped":
            needToAuth = true
            icon.gicon = icon_down;
            statusSwitchItem.setToggleState(false);
            statusItem.label.text = statusString + "down";
            nodes = [];
            setAllItems(false);
            statusSwitchItem.sensitive = true;
            break;
        case "NeedsLogin":
            icon.gicon = icon_down;
            statusSwitchItem.setToggleState(false);
            authUrl = json.AuthURL;
            if (authUrl.length > 0 && needToAuth) {
                Util.spawn(['xdg-open', authUrl])
                needToAuth = false
            }

            authItem.sensitive = true;
            statusItem.label.text = statusString + "needs login";
            authItem.label.text = "Click to Login"
            
            setAllItems(false);
            nodes = [];
            break;

        default:
            myError("Error: unknown state");
    }
}

function setAllItems(b) {
    shieldItem.sensitive = b;
    acceptRoutesItem.sensitive = b;
    allowLanItem.sensitive = b;
    statusSwitchItem.sensitive = b;
    receiveFilesItem.sensitive = b;
    nodesMenu.sensitive = b;
    sendMenu.sensitive = b;
    exitNodeMenu.sensitive = b;
    accountsMenu.sensitive = b;
    accountButton.sensitive = b;
    logoutButton.sensitive = b;
}



function refreshNodesMenu() {
    nodesMenu.menu.removeAll();
    nodes.forEach((node) => {
        let item = new PopupMenu.PopupMenuItem(node.line)
        item.connect('activate', () => {
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, node.address);
            Main.notify("Copied " + node.address + " to clipboard! (" + node.name + ")");
        });
        nodesMenu.menu.addMenuItem(item);
    });
}



function refreshExitNodesMenu() {
    exitNodeMenu.menu.removeAll();
    var uses_exit = false;
    nodes.forEach((node) => {
        if (node.offersExit) {
            var item = new PopupMenu.PopupMenuItem(node.name)
            item.connect('activate', () => {
                cmdTailscale({ args: ["up", "--exit-node=" + node.address, "--reset"] })
            });
            if (node.usesExit) {
                item.setOrnament(1);
                exitNodeMenu.menu.addMenuItem(item);
                uses_exit = true;
            } else {
                item.setOrnament(0);
                exitNodeMenu.menu.addMenuItem(item);
            }
        }
    })

    var noneItem = new PopupMenu.PopupMenuItem('None');
    noneItem.connect('activate', () => {
        cmdTailscale({args: ["up", "--exit-node=", "--reset"] });
    });
    (uses_exit) ? noneItem.setOrnament(0) : noneItem.setOrnament(1);
    exitNodeMenu.menu.addMenuItem(noneItem, 0);
}

function refreshSendMenu() {
    sendMenu.menu.removeAll();
    nodes.forEach((node) => {
        if (node.online && !node.isSelf) {
            var item = new PopupMenu.PopupMenuItem(node.name)
            item.connect('activate', () => {
                sendFiles(node.address);
            });
            sendMenu.menu.addMenuItem(item);
        }
    })
}

function sendFiles(dest) {
    try {
        let proc = Gio.Subprocess.new(
            ["zenity", "--file-selection", "--multiple"],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        proc.communicate_utf8_async(null, null, (proc, res) => {
            try {
                let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                if (proc.get_successful()) {
                    if (stdout != '') {
                        files = stdout.trim().split("|")
                        cmdTailscaleFile(files, dest)
                    }
                } else {
                    myError("zenity failed");
                }
            } catch (e) {
                myError(e);
            }
        });
    } catch (e) {
        myError(e);
    }
}


function cmdTailscaleSwitchList(unprivileged  = true) {
    args = ["switch", "--list"]
    let command = (unprivileged ? ["tailscale"] : ["pkexec", "tailscale"]).concat(args);

    try {
        let proc = Gio.Subprocess.new(
            command,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        proc.communicate_utf8_async(null, null, (proc, res) => {
            try {
                let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                if (proc.get_successful()) {
                    accounts = stdout.split("\n")
                    accounts = accounts.filter((item) => item.length > 0)
                    accountsMenu.menu.removeAll()
                    accounts.forEach((account) => {
                        if (account.slice(-2) == " *") {
                            account = account.slice(0, -2)
                            currentAccount = account
                        }
                        let accountItem = new PopupMenu.PopupMenuItem(account)
                        accountItem.connect('activate', () => {
                            // find the mail address in the account string
                            const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
                            const email = account.match(emailRegex);
                            if (email == null) {
                                myError("failed to extract email from account string")
                                return
                            }
                            cmdTailscaleSwitch(email[0]);
                        });
                        accountsMenu.menu.addMenuItem(accountItem);
                    });
                } else {
                    if (unprivileged) {
                        myWarn("retrying tailscale switch --list")
                        cmdTailscaleSwitchList(false)
                    } else {
                        myError("cmd 'tailscale switch --list' failed")
                    }
                }
            } catch (e) {
                myError(e);
            }
        });
    } catch (e) {
        myError(e);
    }
}

function cmdTailscaleSwitch(account) {
    if (currentAccount == account) {
        Main.notify("Already logged in with " + account)
        return
    } else {
        Main.notify("Switching to " + account)
        currentAccount = account
    }

    cmdTailscale({
        args: ["switch", account],
        addLoginServer: false
    })

}

function cmdTailscaleStatus() {
    try {
        let proc = Gio.Subprocess.new(
            // ["curl", "--silent", "--unix-socket", "/run/tailscale/tailscaled.sock", "http://localhost/localapi/v0/status" ],
            ["tailscale", "status", "--json"],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        proc.communicate_utf8_async(null, null, (proc, res) => {

            try {
                let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                if (proc.get_successful()) {
                    const j = JSON.parse(stdout);
                    extractNodeInfo(j);
                    setStatus(j);
                    refreshExitNodesMenu();
                    refreshSendMenu();
                    refreshNodesMenu();
                }
            } catch (e) {
                myError(e);
            }
        });
    } catch (e) {
        myError(e);
    }
}

function cmdTailscale({args, unprivileged = true, addLoginServer = true}) {
    let original_args = args
    if (addLoginServer) {
        args = args.concat(["--login-server=" + SETTINGS.get_string('login-server')])
    }

    let command = (unprivileged ? ["tailscale"] : ["pkexec", "tailscale"]).concat(args);

    try {
        let proc = Gio.Subprocess.new(
            command,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        proc.communicate_utf8_async(null, null, (proc, res) => {
            try {
                proc.communicate_utf8_finish(res);
                if (!proc.get_successful()) {
                    if (unprivileged) {
                        cmdTailscale({
                            args: args[0] == "up" ? original_args.concat(["--operator=" + GLib.get_user_name(), "--reset"]) : original_args,
                            unprivileged: false,
                            addLoginServer: addLoginServer
                        })
                    } else {
                        myWarn("failed @ cmdTailscale");
                    }
                } else {
                    cmdTailscaleStatus()
                }
            } catch (e) {
                myError(e);
            }
        });
    } catch (e) {
        myError(e);
    }
}

function cmdTailscaleRecFiles() {
    try {
        let proc = Gio.Subprocess.new(
            ["pkexec", "tailscale", "file", "get", downloads_path],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        proc.communicate_utf8_async(null, null, (proc, res) => {
            try {
                proc.communicate_utf8_finish(res);
                if (proc.get_successful()) {
                    Main.notify('Saved files to ' + downloads_path);
                } else {
                    Main.notify('Unable to receive files to ' + downloads_path, 'check logs with journalctl -f -o cat /usr/bin/gnome-shell');
                    myWarn("failed to accept files to " + downloads_path)
                }
            } catch (e) {
                myError(e);
            }
        });
    } catch (e) {
        myError(e);
    }
}

const TailscalePopup = GObject.registerClass(
    class TailscalePopup extends PanelMenu.Button {

        _init() {
            super._init(0);


            icon_down = Gio.icon_new_for_string(Me.dir.get_path() + '/icon-down.svg');
            icon_up = Gio.icon_new_for_string(Me.dir.get_path() + '/icon-up.svg');
            icon_exit_node = Gio.icon_new_for_string(Me.dir.get_path() + '/icon-exit-node.svg');

            icon = new St.Icon({
                gicon: icon_down,
                style_class: 'system-status-icon',
            });

            this.add_child(icon);

            this.menu.connect('open-state-changed', (menu, open) => {
                if (open) {
                    cmdTailscaleStatus();
                }
            });

            
            // ------ MAIN STATUS ITEM ------
            statusItem = new PopupMenu.PopupMenuItem(statusString, { reactive: false });

            // ------ AUTH ITEM ------
            authItem = new PopupMenu.PopupMenuItem("Logged in", false);
            
            authItem.connect('activate', () => {
                cmdTailscaleStatus()
                if (authUrl.length == 0) {
                    try {
                        cmdTailscale({
                            args: ["up"],
                        });
                    } catch (e) {
                        myError(e);
                    }
                }
            });


            // ------ ACCOUNT INDICATOR ------
            accountIndicator = new PopupMenu.PopupMenuItem("Account: ", { reactive: false});

            // ------ MAIN SWITCH ------
            statusSwitchItem = new PopupMenu.PopupSwitchMenuItem("Tailscale", false);
            statusSwitchItem.connect('activate', () => {
                if (statusSwitchItem.state) {
                    cmdTailscale({ args: ["up"] });
                } else {
                    cmdTailscale({
                        args: ["down"],
                        addLoginServer: false
                    });
                }
            })

            // ------ UPDATE ACCOUNTS ------
            accountButton = new PopupMenu.PopupMenuItem("Update Accounts List");
            accountButton.connect('activate', (item) => {
                cmdTailscaleSwitchList()
            })

            // ------ ACCOUNTS ------
            accountsMenu = new PopupMenu.PopupSubMenuMenuItem("Accounts");

            // ------ NODES ------
            nodesMenu = new PopupMenu.PopupSubMenuMenuItem("Nodes");
            nodes.forEach((node) => {
                nodesMenu.menu.addMenuItem(new PopupMenu.PopupMenuItem(node.line));
            });

            // ------ SHIELD ------
            shieldItem = new PopupMenu.PopupSwitchMenuItem("Block Incoming", false);
            shieldItem.connect('activate', () => {
                if (shieldItem.state) {
                    cmdTailscale({ args: ["up", "--shields-up"] });
                } else {
                    cmdTailscale({ args: ["up", "--shields-up=false", "--reset"] });
                }
            })

            
            // ------ ACCEPT ROUTES ------
            acceptRoutesItem = new PopupMenu.PopupSwitchMenuItem("Accept Routes", false);
            acceptRoutesItem.connect('activate', () => {
                if (acceptRoutesItem.state) {
                    cmdTailscale({ args: ["up", "--accept-routes"] });
                } else {
                    cmdTailscale({ args: ["up", "--accept-routes=false", "--reset"] });
                }
            })
            
            // ------ ALLOW DIRECT LAN ACCESS ------
            allowLanItem = new PopupMenu.PopupSwitchMenuItem("Allow Direct Lan Access", false);
            allowLanItem.connect('activate', () => {
                if (allowLanItem.state) {
                    if (nodes[0].usesExit) {
                        cmdTailscale({ args: ["up", "--exit-node-allow-lan-access"] });
                    } else {
                        Main.notify("Must setup exit node first");
                        allowLanItem.setToggleState(false);
                    }
                } else {
                    cmdTailscale({ args: ["up", "--exit-node-allow-lan-access=false", "--reset"] });
                }
            })

            // ------ RECEIVE FILES MENU ------
            receiveFilesItem = new PopupMenu.PopupMenuItem("Accept incoming files");
            receiveFilesItem.connect('activate', () => {
                cmdTailscaleRecFiles();
            })
            
            // ------ SEND FILES MENU ------
            sendMenu = new PopupMenu.PopupSubMenuMenuItem("Send Files");
            
            // ------ EXIT NODES -------
            exitNodeMenu = new PopupMenu.PopupSubMenuMenuItem("Exit Nodes");
            
            // ------ LOG OUT -------
            logoutButton = new PopupMenu.PopupMenuItem("Log Out");
            logoutButton.connect('activate', () => {
                cmdTailscale({
                    args: ["logout"],
                    addLoginServer: false,
                });
            })
            
            // ------ ABOUT MENU------
            let aboutMenu = new PopupMenu.PopupSubMenuMenuItem("About");
            let healthMenu = new PopupMenu.PopupMenuItem("Health")
            healthMenu.connect('activate', () => {
                if (health != null) {
                    Main.notify(health.join());
                    
                } else {
                    Main.notify("null");
                }
            })
            let infoMenu = new PopupMenu.PopupMenuItem("This extension is in no way affiliated with Tailscale Inc.")
            let contributeMenu = new PopupMenu.PopupMenuItem("Contribute")
            contributeMenu.connect('activate', () => {
                Util.spawn(['xdg-open', "https://github.com/maxgallup/tailscale-status#contribute"])
            })
            

            // Order Matters!
            this.menu.addMenuItem(statusSwitchItem);
            this.menu.addMenuItem(statusItem);
            this.menu.addMenuItem(authItem);
            this.menu.addMenuItem(accountIndicator);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this.menu.addMenuItem(nodesMenu);
            this.menu.addMenuItem(accountButton);
            this.menu.addMenuItem(accountsMenu);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this.menu.addMenuItem(shieldItem);
            this.menu.addMenuItem(acceptRoutesItem);
            this.menu.addMenuItem(allowLanItem);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this.menu.addMenuItem(receiveFilesItem);
            this.menu.addMenuItem(sendMenu);
            this.menu.addMenuItem(exitNodeMenu);
            this.menu.addMenuItem(logoutButton);
            this.menu.addMenuItem(aboutMenu);
            aboutMenu.menu.addMenuItem(infoMenu);
            aboutMenu.menu.addMenuItem(contributeMenu);
            aboutMenu.menu.addMenuItem(healthMenu);
        }
    }
);

function init() {
}

function enable() {

    SETTINGS = ExtensionUtils.getSettings(
        'org.gnome.shell.extensions.tailscale-status');
    cmdTailscaleStatus()
    // Timer that updates Status icon and drop down menu
    timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SETTINGS.get_int('refresh-interval'), () => {
        cmdTailscaleStatus();
        return GLib.SOURCE_CONTINUE;
    });

    tailscale = new TailscalePopup();
    Main.panel.addToStatusArea('tailscale', tailscale, 1);
}

function disable() {
    tailscale.destroy();
    tailscale = null;
    icon = null;
    icon_down = null;
    icon_up = null;
    icon_exit_node = null;
    SETTINGS = null;
    accounts = [];

    if (timerId) {
        GLib.Source.remove(timerId);
        timerId = null;
    }


}

