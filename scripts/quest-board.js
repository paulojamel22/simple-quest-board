const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const REWARD_TYPES = {
    coins: { label: "Moedas", icon: "fas fa-coins" },
    item: { label: "Item", icon: "fas fa-shield-halved" },
    consumable: { label: "Consumível", icon: "fas fa-flask" }
};

const QUEST_CATEGORIES = {
    main: { label: "Quest Principal", icon: "fas fa-crown" },
    side: { label: "Sub Quest", icon: "fas fa-scroll" },
    character: { label: "Quest de Personagem", icon: "fas fa-user-shield" }
};

class QuestBoardApp extends HandlebarsApplicationMixin(ApplicationV2) {
    #currentStatusFilter = "all";
    #currentCategoryFilter = "all";
    #searchQuery = "";
    #draggedCardId = null;

    static DEFAULT_OPTIONS = {
        id: "simple-quest-board",
        tag: "div",
        window: {
            title: "Quadro de Missões",
            resizable: true
        },
        position: {
            width: 700,
            height: 620
        },
        actions: {
            addQuest: QuestBoardApp.#onAddQuest,
            deleteQuest: QuestBoardApp.#onDeleteQuest,
            shareQuest: QuestBoardApp.#onShareQuest,
            pickImage: QuestBoardApp.#onPickImage,
            addReward: QuestBoardApp.#onAddReward,
            removeReward: QuestBoardApp.#onRemoveReward,
            addContratant: QuestBoardApp.#onAddContratant,
            removeContratant: QuestBoardApp.#onRemoveContratant,
            addTask: QuestBoardApp.#onAddTask,
            removeTask: QuestBoardApp.#onRemoveTask,
            distributeRewards: QuestBoardApp.#onDistributeRewards
        }
    };

    static PARTS = {
        main: {
            template: "modules/simple-quest-board/templates/quest-board.hbs"
        }
    };

    static open() {
        const existing = foundry.applications.instances.get("simple-quest-board");
        if (existing) existing.render(true);
        else new QuestBoardApp().render(true);
    }

    static refreshAll() {
        for (const app of foundry.applications.instances.values()) {
            if (app instanceof QuestBoardApp) {
                app.render({ force: true });
            }
        }
    }

    async _prepareContext(_options) {
        const rawQuests = game.settings.get("simple-quest-board", "quests") || [];
        const questsList = foundry.utils.deepClone(rawQuests);

        const filteredQuests = questsList.filter(q => {
            if (this.#currentStatusFilter !== "all" && q.status !== this.#currentStatusFilter) return false;
            const category = q.category || "side";
            if (this.#currentCategoryFilter !== "all" && category !== this.#currentCategoryFilter) return false;
            if (this.#searchQuery.trim() !== "") {
                const query = this.#searchQuery.toLowerCase();
                const titleMatch = q.title?.toLowerCase().includes(query);
                const descMatch = q.description?.toLowerCase().includes(query);
                if (!titleMatch && !descMatch) return false;
            }
            return true;
        });

        const quests = await Promise.all(filteredQuests.map(async (q) => {
            const enrichedDescription = await TextEditor.enrichHTML(q.description || "", {
                async: true,
                secrets: game.user.isGM
            });

            let rewardsList = (Array.isArray(q.rewards) ? q.rewards : []).map(r => ({
                ...r,
                icon: REWARD_TYPES[r.type]?.icon || "fas fa-gift"
            }));

            const contratantsList = Array.isArray(q.contratants) ? q.contratants : [];
            const category = q.category || "side";
            const catConfig = QUEST_CATEGORIES[category] || QUEST_CATEGORIES.side;

            const tasks = Array.isArray(q.tasks) ? q.tasks : [];
            const completedTasksCount = tasks.filter(t => t.completed).length;
            const progressPercent = tasks.length > 0 ? Math.round((completedTasksCount / tasks.length) * 100) : 0;

            return {
                ...q,
                category,
                categoryLabel: catConfig.label,
                categoryIcon: catConfig.icon,
                enrichedDescription,
                rewards: rewardsList,
                contratants: contratantsList,
                tasks,
                completedTasksCount,
                progressPercent,
                isAvailable: q.status === "available",
                isInProgress: q.status === "in_progress",
                isCompleted: q.status === "completed"
            };
        }));

        return {
            isGM: game.user.isGM,
            quests,
            currentStatusFilter: this.#currentStatusFilter,
            currentCategoryFilter: this.#currentCategoryFilter,
            searchQuery: this.#searchQuery
        };
    }

    async saveStateFromDOM() {
        if (!game.user.isGM) return;
        const currentQuests = foundry.utils.deepClone(game.settings.get("simple-quest-board", "quests") || []);

        this.element.querySelectorAll(".quest-card").forEach(card => {
            const questId = card.dataset.id;
            const quest = currentQuests.find(q => String(q.id) === String(questId));
            if (!quest) return;

            const titleInput = card.querySelector(".title-input");
            if (titleInput) quest.title = titleInput.value;

            const categorySelect = card.querySelector(".category-select");
            if (categorySelect) quest.category = categorySelect.value;

            const descInput = card.querySelector(".desc-input");
            if (descInput) quest.description = descInput.value;

            const imgInput = card.querySelector(".img-input");
            if (imgInput) quest.img = imgInput.value;

            const taskItems = card.querySelectorAll(".task-item");
            taskItems.forEach((item, index) => {
                if (quest.tasks && quest.tasks[index]) {
                    const cb = item.querySelector(".task-checkbox");
                    const txt = item.querySelector(".task-input");
                    if (cb) quest.tasks[index].completed = cb.checked;
                    if (txt) quest.tasks[index].text = txt.value;
                }
            });
        });

        await game.settings.set("simple-quest-board", "quests", currentQuests);
    }

    // --- Handlers de Ações Restritas a GM (Injetados via actions) ---
    static async #onAddQuest(event, target) {
        if (!game.user.isGM) return;
        await this.saveStateFromDOM();

        const currentQuests = foundry.utils.deepClone(game.settings.get("simple-quest-board", "quests") || []);
        currentQuests.push({
            id: foundry.utils.randomID(),
            title: "Nova Missão",
            category: "side",
            description: "Detalhes da missão...",
            rewards: [],
            contratants: [],
            tasks: [],
            img: "",
            status: "available",
            acceptedBy: ""
        });
        await game.settings.set("simple-quest-board", "quests", currentQuests);
    }

    static async #onDeleteQuest(event, target) {
        if (!game.user.isGM) return;
        const questId = target.dataset.id || target.closest(".quest-card")?.dataset.id;
        if (!questId) return;

        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: "Excluir Missão" },
            content: "<p>Tem certeza que deseja remover esta missão do quadro?</p>",
            rejectClose: false
        });

        if (!confirmed) return;

        await this.saveStateFromDOM();
        const currentQuests = foundry.utils.deepClone(game.settings.get("simple-quest-board", "quests") || []);
        const filtered = currentQuests.filter(q => String(q.id) !== String(questId));
        await game.settings.set("simple-quest-board", "quests", filtered);
    }

    static async #onAddContratant(event, target) {
        if (!game.user.isGM) return;
        const questId = target.dataset.id || target.closest(".quest-card")?.dataset.id;

        const result = await foundry.applications.api.DialogV2.prompt({
            window: { title: "Adicionar Contratante" },
            content: `
        <form class="flexcol" style="gap: 10px;">
          <div class="form-group"><label>Nome do Contratante:</label>
            <input type="text" name="contratantName" placeholder="Ex: Ferreiro Bob" required autofocus />
          </div>
        </form>
      `,
            ok: {
                label: "Adicionar",
                callback: (e, btn) => btn.form.elements.contratantName.value.trim()
            },
            rejectClose: false
        });

        if (!result) return;

        await this.saveStateFromDOM();
        const currentQuests = foundry.utils.deepClone(game.settings.get("simple-quest-board", "quests") || []);
        const updated = currentQuests.map(q => {
            if (String(q.id) === String(questId)) {
                const contratants = Array.isArray(q.contratants) ? q.contratants : [];
                return { ...q, contratants: [...contratants, { name: result, img: "", icon: "fas fa-user" }] };
            }
            return q;
        });

        await game.settings.set("simple-quest-board", "quests", updated);
    }

    static async #onRemoveContratant(event, target) {
        if (!game.user.isGM) return;
        const questId = target.dataset.questId;
        const index = parseInt(target.dataset.index, 10);

        await this.saveStateFromDOM();
        const currentQuests = foundry.utils.deepClone(game.settings.get("simple-quest-board", "quests") || []);
        const updated = currentQuests.map(q => {
            if (String(q.id) === String(questId) && Array.isArray(q.contratants)) {
                const contratants = [...q.contratants];
                contratants.splice(index, 1);
                return { ...q, contratants };
            }
            return q;
        });

        await game.settings.set("simple-quest-board", "quests", updated);
    }

    static async #onAddTask(event, target) {
        if (!game.user.isGM) return;
        const questId = target.dataset.id || target.closest(".quest-card")?.dataset.id;

        await this.saveStateFromDOM();
        const currentQuests = foundry.utils.deepClone(game.settings.get("simple-quest-board", "quests") || []);
        const updated = currentQuests.map(q => {
            if (String(q.id) === String(questId)) {
                const tasks = Array.isArray(q.tasks) ? q.tasks : [];
                return { ...q, tasks: [...tasks, { text: "Novo Objetivo", completed: false }] };
            }
            return q;
        });

        await game.settings.set("simple-quest-board", "quests", updated);
    }

    static async #onRemoveTask(event, target) {
        if (!game.user.isGM) return;
        const questId = target.dataset.questId;
        const index = parseInt(target.dataset.index, 10);

        await this.saveStateFromDOM();
        const currentQuests = foundry.utils.deepClone(game.settings.get("simple-quest-board", "quests") || []);
        const updated = currentQuests.map(q => {
            if (String(q.id) === String(questId) && Array.isArray(q.tasks)) {
                const tasks = [...q.tasks];
                tasks.splice(index, 1);
                return { ...q, tasks };
            }
            return q;
        });

        await game.settings.set("simple-quest-board", "quests", updated);
    }

    static async #onAddReward(event, target) {
        if (!game.user.isGM) return;
        const questId = target.dataset.id || target.closest(".quest-card")?.dataset.id;

        const result = await foundry.applications.api.DialogV2.prompt({
            window: { title: "Adicionar Recompensa" },
            content: `
        <form class="flexcol" style="gap: 10px;">
          <div class="form-group"><label>Tipo:</label>
            <select name="rewardType">
              <option value="coins">Moedas</option>
              <option value="item">Item</option>
              <option value="consumable">Consumível</option>
            </select>
          </div>
          <div class="form-group"><label>Texto:</label>
            <input type="text" name="rewardText" placeholder="Ex: 150 PO" required autofocus />
          </div>
        </form>
      `,
            ok: {
                label: "Adicionar",
                callback: (e, btn) => ({ type: btn.form.elements.rewardType.value, text: btn.form.elements.rewardText.value.trim() })
            },
            rejectClose: false
        });

        if (!result?.text) return;

        await this.saveStateFromDOM();
        const currentQuests = foundry.utils.deepClone(game.settings.get("simple-quest-board", "quests") || []);
        const updated = currentQuests.map(q => {
            if (String(q.id) === String(questId)) {
                const rewards = Array.isArray(q.rewards) ? q.rewards : [];
                return { ...q, rewards: [...rewards, { type: result.type, text: result.text }] };
            }
            return q;
        });

        await game.settings.set("simple-quest-board", "quests", updated);
    }

    static async #onRemoveReward(event, target) {
        if (!game.user.isGM) return;
        const questId = target.dataset.questId;
        const index = parseInt(target.dataset.index, 10);

        await this.saveStateFromDOM();
        const currentQuests = foundry.utils.deepClone(game.settings.get("simple-quest-board", "quests") || []);
        const updated = currentQuests.map(q => {
            if (String(q.id) === String(questId) && Array.isArray(q.rewards)) {
                const rewards = [...q.rewards];
                rewards.splice(index, 1);
                return { ...q, rewards };
            }
            return q;
        });

        await game.settings.set("simple-quest-board", "quests", updated);
    }

    static async #onDistributeRewards(event, target) {
        if (!game.user.isGM) return;
        const questId = target.dataset.id;
        const currentQuests = game.settings.get("simple-quest-board", "quests") || [];
        const quest = currentQuests.find(q => String(q.id) === String(questId));
        if (!quest) return;

        const actor = game.actors.find(a => a.name === quest.acceptedBy) || game.user.character;
        if (!actor) {
            ui.notifications.warn("Nenhum ator correspondente foi encontrado para entregar as recompensas.");
            return;
        }

        const itemRewards = (quest.rewards || []).filter(r => r.uuid);
        if (itemRewards.length === 0) {
            ui.notifications.info("Esta missão não tem itens do Foundry vinculados para transferência automática.");
            return;
        }

        const itemsToCreate = [];
        for (const r of itemRewards) {
            const doc = await fromUuid(r.uuid);
            if (doc && doc.documentName === "Item") {
                itemsToCreate.push(doc.toObject());
            }
        }

        if (itemsToCreate.length) {
            await actor.createEmbeddedDocuments("Item", itemsToCreate);
            ui.notifications.info(`Recompensas entregues com sucesso para ${actor.name}!`);
        }
    }

    static async #onPickImage(event, target) {
        if (!game.user.isGM) return;
        const questId = target.dataset.id || target.closest(".quest-card")?.dataset.id;

        await this.saveStateFromDOM();
        const currentQuests = foundry.utils.deepClone(game.settings.get("simple-quest-board", "quests") || []);
        const quest = currentQuests.find(q => String(q.id) === String(questId));

        new FilePicker({
            type: "image",
            current: quest?.img || "",
            callback: async (path) => {
                const updated = currentQuests.map(q => String(q.id) === String(questId) ? { ...q, img: path } : q);
                await game.settings.set("simple-quest-board", "quests", updated);
            }
        }).browse();
    }

    static async #onShareQuest(event, target) {
        if (!game.user.isGM) return;
        const questId = target.dataset.id || target.closest(".quest-card")?.dataset.id;
        const currentQuests = game.settings.get("simple-quest-board", "quests") || [];
        const quest = currentQuests.find(q => String(q.id) === String(questId));
        if (!quest) return;

        await QuestBoardApp.postChatNotification(quest, "Missão Compartilhada");
    }

    // --- Lógica Híbrida de Atualização de Status (Client / GM) ---
    static async updateQuestStatus(questId, newStatus, acceptedBy = null) {
        // Se for um Jogador, repassa a alteração via Socket
        if (!game.user.isGM) {
            const hasActiveGM = game.users.some(u => u.isGM && u.active);
            if (!hasActiveGM) {
                ui.notifications.error("O Mestre precisa estar online para que a missão seja aceita.");
                return;
            }

            ui.notifications.info("Aceitando missão...");
            game.socket.emit("module.simple-quest-board", {
                action: "requestUpdateStatus",
                questId: questId,
                newStatus: newStatus,
                acceptedBy: acceptedBy
            });
            return;
        }

        // Executado apenas pelo GM:
        const currentQuests = foundry.utils.deepClone(game.settings.get("simple-quest-board", "quests") || []);
        let updatedQuest = null;

        const updatedQuests = currentQuests.map(q => {
            if (String(q.id) === String(questId)) {
                q.status = newStatus;
                if (acceptedBy !== null) q.acceptedBy = acceptedBy;
                updatedQuest = q;
            }
            return q;
        });

        // Este salvamento irá disparar o Hooks.on("updateSetting") para todos
        await game.settings.set("simple-quest-board", "quests", updatedQuests);

        if (updatedQuest) {
            if (newStatus === "in_progress") {
                QuestBoardApp.postChatNotification(updatedQuest, `Missão Aceita por ${updatedQuest.acceptedBy}!`);
            } else if (newStatus === "completed") {
                AudioHelper.play({ src: "sounds/lock.wav", volume: 0.8 }, true);
                QuestBoardApp.postChatNotification(updatedQuest, "🎉 Missão Concluída!");
            }
        }
    }

    static async postChatNotification(quest, bannerTitle) {
        const enrichedDescription = await TextEditor.enrichHTML(quest.description || "", { async: true, secrets: false });
        const catConfig = QUEST_CATEGORIES[quest.category || "side"] || QUEST_CATEGORIES.side;
        const rewardsList = (quest.rewards || []).map(r => ({ ...r, icon: REWARD_TYPES[r.type]?.icon || "fas fa-gift" }));

        const content = await renderTemplate("modules/simple-quest-board/templates/quest-chat-card.hbs", {
            ...quest,
            bannerTitle,
            categoryLabel: catConfig.label,
            categoryIcon: catConfig.icon,
            enrichedDescription,
            rewards: rewardsList
        });

        await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ alias: "Quadro de Missões" }),
            content: content,
            style: CONST.CHAT_MESSAGE_STYLES?.OOC ?? 1
        });
    }

    _onRender(context, options) {
        super._onRender(context, options);

        // Listener explícito para todos: Garante o clique de Aceitar independentemente de permissões de GM
        this.element.querySelectorAll("[data-action='acceptQuest']").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                e.preventDefault();
                const questId = btn.dataset.id || btn.closest(".quest-card")?.dataset.id;
                const actorName = game.user.character?.name || game.user.name;

                if (questId) {
                    await QuestBoardApp.updateQuestStatus(questId, "in_progress", actorName);
                }
            });
        });

        const searchInput = this.element.querySelector(".search-input");
        if (searchInput) {
            searchInput.addEventListener("input", (e) => {
                this.#searchQuery = e.target.value;
                this.render({ force: true });
            });
        }

        const statusFilter = this.element.querySelector(".status-filter-select");
        if (statusFilter) {
            statusFilter.addEventListener("change", (e) => {
                this.#currentStatusFilter = e.target.value;
                this.render({ force: true });
            });
        }

        const categoryFilter = this.element.querySelector(".category-filter-select");
        if (categoryFilter) {
            categoryFilter.addEventListener("change", (e) => {
                this.#currentCategoryFilter = e.target.value;
                this.render({ force: true });
            });
        }

        // Restante do _onRender apenas para GMs
        if (!game.user.isGM) return;

        this.element.querySelectorAll(".quest-input, .quest-select[data-field], .task-input, .task-checkbox").forEach(input => {
            input.addEventListener("blur", async () => {
                await this.saveStateFromDOM();
            });
        });

        this.element.querySelectorAll(".status-select").forEach(select => {
            select.addEventListener("change", async (e) => {
                await this.saveStateFromDOM();
                const questId = e.target.dataset.id || e.target.closest(".quest-card")?.dataset.id;
                if (questId) await QuestBoardApp.updateQuestStatus(questId, e.target.value);
            });
        });

        // Drag & Drop
        this.element.querySelectorAll(".reward-dropzone").forEach(dropzone => {
            dropzone.addEventListener("dragover", e => e.preventDefault());
            dropzone.addEventListener("drop", async (e) => {
                e.preventDefault();
                await this.saveStateFromDOM();
                const questId = dropzone.dataset.questId;

                let data;
                try { data = JSON.parse(e.dataTransfer.getData("text/plain")); } catch (err) { return; }
                if (!data) return;

                if ((data.type === "Actor" || dropzone.dataset.dropType === "giver") && data.uuid) {
                    const actor = await fromUuid(data.uuid);
                    if (!actor || actor.documentName !== "Actor") return;

                    const currentQuests = foundry.utils.deepClone(game.settings.get("simple-quest-board", "quests") || []);
                    const updated = currentQuests.map(q => {
                        if (String(q.id) === String(questId)) {
                            const contratants = Array.isArray(q.contratants) ? q.contratants : [];
                            if (!contratants.some(c => c.uuid === actor.uuid)) {
                                contratants.push({ name: actor.name, img: actor.img, uuid: actor.uuid });
                            }
                            return { ...q, contratants };
                        }
                        return q;
                    });

                    await game.settings.set("simple-quest-board", "quests", updated);
                    return;
                }

                if ((data.type === "Item" || data.uuid)) {
                    const item = await fromUuid(data.uuid);
                    if (!item || item.documentName !== "Item") return;

                    const currentQuests = foundry.utils.deepClone(game.settings.get("simple-quest-board", "quests") || []);
                    const updated = currentQuests.map(q => {
                        if (String(q.id) === String(questId)) {
                            const rewards = Array.isArray(q.rewards) ? q.rewards : [];
                            rewards.push({ type: "item", text: item.name, img: item.img, uuid: item.uuid });
                            return { ...q, rewards };
                        }
                        return q;
                    });

                    await game.settings.set("simple-quest-board", "quests", updated);
                }
            });
        });

        this.element.querySelectorAll(".quest-card").forEach(card => {
            card.addEventListener("dragstart", (e) => {
                this.#draggedCardId = card.dataset.id;
                e.dataTransfer.effectAllowed = "move";
            });

            card.addEventListener("dragover", (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
            });

            card.addEventListener("drop", async (e) => {
                e.preventDefault();
                const targetCardId = card.dataset.id;
                if (!this.#draggedCardId || this.#draggedCardId === targetCardId) return;

                await this.saveStateFromDOM();
                const currentQuests = foundry.utils.deepClone(game.settings.get("simple-quest-board", "quests") || []);
                const dragIndex = currentQuests.findIndex(q => String(q.id) === String(this.#draggedCardId));
                const targetIndex = currentQuests.findIndex(q => String(q.id) === String(targetCardId));

                if (dragIndex > -1 && targetIndex > -1) {
                    const [movedQuest] = currentQuests.splice(dragIndex, 1);
                    currentQuests.splice(targetIndex, 0, movedQuest);
                    this.#draggedCardId = null;
                    await game.settings.set("simple-quest-board", "quests", currentQuests);
                }
            });
        });
    }
}

// Hooks
Hooks.once("init", () => {
    game.settings.register("simple-quest-board", "quests", {
        name: "Quest Board Data",
        scope: "world",
        config: false,
        type: Array,
        default: []
    });

    game.modules.get("simple-quest-board").QuestBoardApp = QuestBoardApp;

    // Escuta do GM para solicitações via Socket
    game.socket.on("module.simple-quest-board", async (data) => {
        if (!game.user.isGM) return;
        if (data.action === "requestUpdateStatus") {
            await QuestBoardApp.updateQuestStatus(data.questId, data.newStatus, data.acceptedBy);
        }
    });
});

// A chave exata de Setting passada no V12 costuma ser apenas "quests", e verificamos o namespace para evitar conflitos
Hooks.on("updateSetting", (setting) => {
    const key = setting.key || setting.id || "";
    if (key.includes("simple-quest-board.quests") || key === "quests") {
        QuestBoardApp.refreshAll();
    }
});

Hooks.once("ready", async () => {
    if (!game.user.isGM) return;

    const packKey = "simple-quest-board.quest-board-macros";
    const pack = game.packs.get(packKey);

    if (!pack) {
        console.warn(`Simple Quest Board | Compêndio ${packKey} não encontrado no manifest.`);
        return;
    }

    // Solução: Força o index a carregar o campo "name" explicitamente
    const index = await pack.getIndex({ fields: ["name"] });
    const existingMacro = index.find(m => m.name === "Abrir Quadro de Missões");

    // Cria a macro apenas se ela NÃO existir no compêndio
    if (!existingMacro) {
        const macro = await Macro.create({
            name: "Abrir Quadro de Missões",
            type: "script",
            img: "icons/sundries/books/book-backed-blue-gold.webp",
            command: `game.modules.get("simple-quest-board")?.QuestBoardApp?.open();`,
            flags: { "simple-quest-board": { autoCreated: true } }
        }, { temporary: true });

        await pack.importDocument(macro);
        ui.notifications.info("Simple Quest Board: Macro adicionada ao compêndio!");
    }
});