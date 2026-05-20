export class AmisAPI {
    static async getToken() {
        const cached = await chrome.storage.session.get("amis_token");
        if (cached.amis_token) return cached.amis_token;

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url.includes("amis.uplb.edu.ph")) {
            throw new Error("AMIS session not found. Please navigate to the AMIS portal and log in.");
        }

        const result = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                const knownKeys = ['token', 'authToken', 'access_token', 'vuex'];
                for (const store of [localStorage, sessionStorage]) {
                    for (const key of knownKeys) {
                        const val = store.getItem(key);
                        if (!val) continue;
                        try {
                            const parsed = JSON.parse(val);
                            if (parsed?.token) return parsed.token;
                            if (parsed?.access_token) return parsed.access_token;
                        } catch {
                            if (typeof val === "string" && (val.includes("|") || val.split('.').length === 3)) return val;
                        }
                    }
                }
                for (const store of [localStorage, sessionStorage]) {
                    for (const key of Object.keys(store)) {
                        const value = store.getItem(key);
                        if (!value) continue;
                        try {
                            const parsed = JSON.parse(value);
                            if (parsed?.token) return parsed.token;
                            if (parsed?.access_token) return parsed.access_token;
                        } catch {}
                        if (typeof value === "string" && value.includes("|") && value.length > 20) return value;
                    }
                }
                return null;
            }
        });
        
        const token = result?.[0]?.result;
        if (!token) {
            await this.clearSession();
            throw new Error("Could not find an active AMIS token. Please log out and log back into AMIS.");
        }

        await chrome.storage.session.set({ "amis_token": token });
        return token;
    }

    static async clearSession() {
        await chrome.storage.session.remove("amis_token");
    }

    static async fetchWithAuth(url, token) {
        const response = await fetch(url, { 
            headers: { 
                Authorization: `Bearer ${token}`, 
                Accept: "application/json", 
                "X-Requested-With": "XMLHttpRequest" 
            } 
        });

        if (!response.ok) {
            if (response.status === 401) {
                await this.clearSession();
                throw new Error("AMIS session expired. Please refresh your AMIS tab and try again.");
            }
            throw new Error(`API Error: Received status code ${response.status}`);
        }
        return response.json();
    }

    static async getStudentData(token) {
        const authUser = await this.fetchWithAuth("https://api-amis.uplb.edu.ph/api/auth/user", token);
        const userId = authUser.user?.id; 
        if (!userId) throw new Error("Could not retrieve dynamic user ID from AMIS.");

        const [grades, profile] = await Promise.all([
            this.fetchWithAuth("https://api-amis.uplb.edu.ph/api/students/grades?summarize=true", token),
            this.fetchWithAuth(`https://api-amis.uplb.edu.ph/api/users/${userId}?personal_information=true`, token)
        ]);
        return { grades, profile };
    }
}