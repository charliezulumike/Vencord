import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { ChannelStore, GuildStore, UserStore, VoiceStateStore } from "@webpack/common";

// Initialize a logger for clean console output, prefixed with the plugin name.
const logger = new Logger("VoiceChannelMonitor", "#87CEEB");

/**
 * Retrieves the current state of all voice channels across all guilds
 * and logs it to the console.
 */
function logInitialState() {
    try {
        const allGuilds = Object.values(GuildStore.getGuilds());
        const voiceStates: Record<string, Record<string, string[]>> = {};
        let activeUsers = 0;

        for (const guild of allGuilds) {
            const guildChannels = Object.values(ChannelStore.getMutableGuildChannelsForGuild(guild.id));
            const voiceChannels = guildChannels.filter(c => c.isVocal());

            if (voiceChannels.length === 0) continue;

            const guildVoiceStates: Record<string, string[]> = {};
            for (const vc of voiceChannels) {
                const usersInVc = Object.values(VoiceStateStore.getVoiceStatesForChannel(vc.id));

                if (usersInVc.length > 0) {
                    const userNames = usersInVc.map(vs => {
                        const user = UserStore.getUser(vs.userId);
                        return user?.username ?? `Unknown User (${vs.userId})`;
                    });
                    guildVoiceStates[vc.name] = userNames;
                    activeUsers += userNames.length;
                }
            }

            if (Object.keys(guildVoiceStates).length > 0) {
                voiceStates[guild.name] = guildVoiceStates;
            }
        }

        if (activeUsers > 0) {
            logger.log("Initial voice channel states:", voiceStates);
        } else {
            logger.log("No users are currently in any voice channels.");
        }
    } catch (error) {
        logger.error("Failed to retrieve initial voice state:", error);
    }
}

// Interface for the voice state update event payload
interface VoiceStateUpdate {
    userId: string;
    channelId?: string;
    oldChannelId?: string;
    // Includes other properties like mute, deaf, etc.
    [key: string]: any;
}

export default definePlugin({
    name: "VoiceChannelMonitor",
    description: "Retrieves the state of all voice channels in all guilds and logs updates to the console.",
    authors: [Devs.Ven], // Example author

    /**
     * Called when the plugin is enabled. We wait a few seconds for Discord's
     * internal stores to be populated before logging the initial state.
     */
    start() {
        setTimeout(logInitialState, 5000);
    },

    /**
     * Hooks into Discord's Flux event dispatcher to listen for real-time updates.
     */
    flux: {
        /**
         * Handles voice state updates.
         * @param {object} payload - The event payload.
         * @param {VoiceStateUpdate[]} payload.voiceStates - An array of voice state changes.
         */
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceStateUpdate[]; }) {
            for (const update of voiceStates) {
                try {
                    const user = UserStore.getUser(update.userId);
                    if (!user) continue;

                    const oldChannel = update.oldChannelId ? ChannelStore.getChannel(update.oldChannelId) : null;
                    const newChannel = update.channelId ? ChannelStore.getChannel(update.channelId) : null;

                    if (newChannel && !oldChannel) {
                        const guild = newChannel.guild_id ? GuildStore.getGuild(newChannel.guild_id) : null;
                        logger.info(`${user.username} joined VC: '${newChannel.name}' in '${guild?.name ?? "a DM/Group"}'`);
                    } else if (!newChannel && oldChannel) {
                        const guild = oldChannel.guild_id ? GuildStore.getGuild(oldChannel.guild_id) : null;
                        logger.info(`${user.username} left VC: '${oldChannel.name}' in '${guild?.name ?? "a DM/Group"}'`);
                    } else if (newChannel && oldChannel && newChannel.id !== oldChannel.id) {
                        const oldGuild = oldChannel.guild_id ? GuildStore.getGuild(oldChannel.guild_id) : null;
                        const newGuild = newChannel.guild_id ? GuildStore.getGuild(newChannel.guild_id) : null;
                        logger.info(`${user.username} moved from '${oldChannel.name}' (${oldGuild?.name ?? "DM/Group"}) to '${newChannel.name}' (${newGuild?.name ?? "DM/Group"})`);
                    } else if (newChannel) {
                        const guild = newChannel.guild_id ? GuildStore.getGuild(newChannel.guild_id) : null;
                        logger.log(`${user.username}'s state updated in '${newChannel.name}' (${guild?.name ?? "a DM/Group"})`, update);
                    }
                } catch (error) {
                    logger.error("Failed to process a voice state update:", error, "Update data:", update);
                }
            }
        },
    },
});