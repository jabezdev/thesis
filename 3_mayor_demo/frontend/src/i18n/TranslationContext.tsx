import { createContext, useContext, useState, type ReactNode } from 'react';

type Language = 'en' | 'tl' | 'pam';

type Translations = {
    [key in Language]: {
        [key: string]: string;
    };
};

const translations: Translations = {
    en: {
        app_title: 'Panahon.live Demo',
        current_weather: 'Current Weather',
        temperature: 'Temperature',
        humidity: 'Humidity',
        rainfall: 'Rainfall',
        last_updated: 'Last updated',
        view_dashboard: 'LGU Dashboard',
        status_online: 'Online',
        status_offline: 'Offline',
        no_data: 'No data available yet.',
    },
    tl: {
        app_title: 'Demo ng Panahon.live',
        current_weather: 'Kasalukuyang Panahon',
        temperature: 'Temperatura',
        humidity: 'Alinsangan',
        rainfall: 'Ulan',
        last_updated: 'Huling na-update',
        view_dashboard: 'LGU Dashboard',
        status_online: 'Online',
        status_offline: 'Offline',
        no_data: 'Wala pang datos.',
    },
    pam: {
        app_title: 'Panahon.live Demo',
        current_weather: 'Kasalungsungan a Panaun',
        temperature: 'Temperatura',
        humidity: 'Alimum',
        rainfall: 'Uran',
        last_updated: 'Tauling me-update',
        view_dashboard: 'LGU Dashboard',
        status_online: 'Online',
        status_offline: 'Offline',
        no_data: 'Ala pang data.',
    },
};

interface TranslationContextType {
    language: Language;
    setLanguage: (lang: Language) => void;
    t: (key: string) => string;
}

const TranslationContext = createContext<TranslationContextType | undefined>(undefined);

export const TranslationProvider = ({ children }: { children: ReactNode }) => {
    const [language, setLanguage] = useState<Language>('en');

    const t = (key: string) => {
        return translations[language][key] || key;
    };

    return (
        <TranslationContext.Provider value={{ language, setLanguage, t }}>
            {children}
        </TranslationContext.Provider>
    );
};

export const useTranslation = () => {
    const context = useContext(TranslationContext);
    if (context === undefined) {
        throw new Error('useTranslation must be used within a TranslationProvider');
    }
    return context;
};
