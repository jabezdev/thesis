# PAMPANGA STATE UNIVERSITY
## Bacolor, Pampanga
### College of Engineering and Architecture
### Department of Electronics Engineering

---

# Development of a Low-cost Local Weather Monitoring System for Local Government Unit Application

**Authors:**
AYSON, JABEZ M.
CABRERA, ERVIN JOHN R.
CRISOSTOMO, GABRIEL CARL C.
JADIE, ASHLEY JADE G.
SANTOS, KRIZLE FEYH G.

**Date:** September 2025
**Adviser:** ENGR. ELIAS FRANCIS G. VERGARRA

---

# CHAPTER 1: INTRODUCTION

## Background of the Study

Weather greatly influences human life, shaping daily activities, agricultural productivity, transportation, and even public health. In recent years, climate variability has resulted in more frequent and intense natural hazards such as storms, floods, droughts, and heatwaves. These extreme events cause significant disruptions to communities, destroy livelihoods, and endanger human lives.

Countries in the Asia-Pacific region, particularly the Philippines, are highly exposed to such events due to their geographical location and tropical climate. According to the Philippine Atmospheric, Geophysical and Astronomical Services Administration (PAGASA), the country experiences an average of 20 tropical cyclones each year, many of which bring devastating impacts to lives and property. In addition, the Philippines has recently faced increasing heat extremes. For instance, during the 2024 pre-monsoon season, heat indices reached up to 53°C in Iba, Zambales, while many provinces recorded values between 42°C and 51°C—conditions that PAGASA classified as “danger” levels. These figures highlight the growing urgency of improving weather monitoring and preparedness systems at both national and local levels.

Despite the availability of national forecasts, localized weather information remains limited or delayed for many Local Government Units (LGUs), especially those in rural and resource-constrained areas. This lack of timely and location-specific data weakens their ability to anticipate, respond to, and mitigate the effect of weather-related hazards. Domingo et al. (2020) found that smallholder farmers in Benguet often face challenges in applying climate information due to its complexity and lack of localization. Similarly, the United Nations Office for Disaster Risk Reduction (UNDRR, 2019) emphasized that integrating information and communication technologies (ICTs) into local governance can greatly strengthen disaster resilience. PreventionWeb (2023) also reported that automated weather stations deployed across the Philippines have significantly improved disaster preparedness, particularly in vulnerable communities. These findings underscore the importance of accessible, real-time weather information tailored to specific localities.

**Automatic Weather Stations (AWS)** play a crucial role in addressing this gap. AWS are advanced technologies designed to autonomously collect, store, and transmit meteorological data such as temperature, humidity, and precipitation. They operate continuously with minimal human intervention, making them suitable for deployment in remote areas. Historically, the concept of AWS can be traced back to the mid-20th century, when early meteorologists explored automation to enhance observation networks (Wood, 2006). Over the years, advancements in digital electronics, low-power systems, and wireless communication have transformed AWS into intelligent systems capable of real-time data transmission, cloud integration, and Internet of Things (IoT) connectivity. These innovations have changed the way weather data are collected, processed, and shared, allowing for faster and more accurate monitoring.

However, the widespread adoption of AWS remains limited due to several technical and economic challenges. Professional-grade AWS units used by national meteorological agencies can cost thousands of pesos, making them unaffordable for most small LGUs. In addition to cost, challenges such as unreliable connectivity, limited power supply in off-grid areas, and the need for regular sensor calibration hinder continuous operation. Rivera et al. (2023) sought to address these issues by developing a cost-effective and user-friendly local weather station that utilizes low-cost sensors and open-source platforms. Their work demonstrated that affordable, community-level AWS can still deliver accurate and reliable weather data suitable for local decision-making. Similarly, studies by Tolentino and Ladincho (2013) and Delos Santos (2023) revealed that the usefulness of climate information depends heavily on how localized and context-specific it is. Cutter et al. (2012) further emphasized that the success of disaster management efforts often relies on timely and site-specific data that directly inform local actions and policies.

Even with international progress in AWS technology, issues such as power reliability, data interoperability, and limited technical capacity for maintenance remain obstacles, particularly in developing countries like the Philippines (Kumar et al., 2018). The absence of standardized systems for data sharing among institutions also limits the integration of localized weather data into broader national frameworks.

Thus, these gaps create an urgent need for innovative, low-cost, and sustainable weather monitoring systems designed specifically for the needs of LGUs and local communities. The challenges reflect national and global issues surrounding localized weather monitoring; their impact becomes more pronounced when examined at the level of individual communities. The need for reliable, site-specific weather information is especially critical in areas where historical, geographical, and environmental factors heighten local risk. In this context, understanding the unique vulnerabilities of the project’s chosen site becomes essential.

The **Municipality of Bacolor** presents a distinct set of hazards and community conditions that further justify the development of a localized Automatic Weather Station tailored to its needs. The municipality remains an area with significant exposure to environmental hazards. The long-term impacts of the 1991 Mount Pinatubo eruption and subsequent lahar deposition have altered the municipality’s topography, contributing to persistent risks such as localized flooding, river overflow, and sediment-related hazards during periods of intense rainfall.

According to an employee from the Municipal Disaster Risk Reduction and Management Office (MDRRMO) of the Municipality of Bacolor, the office currently relies primarily on national weather forecasts and publicly available tools such as data from PAGASA and the Windy platform when monitoring local conditions (MDRRMO Officer, personal communication, October 2025). The respondent also mentioned that the city still does not use quantifiable, instrument-based hydrological data. Instead, barangay captains typically assess flood risks using visual observation or the so-called “eye test” for water levels in their respective areas (MDRRMO Officer, personal communication, October 2025). The initial close interview with officer from MDRRMO also mentioned their need for acquiring an Automatic Weather Station (AWS) to meet their needs regarding quantifiable meteorological data due to their vulnerability to environmental hazards.

## Statement of the Problem

The Municipality of Bacolor, Pampanga currently lacks hyper-local environmental data, making it difficult to obtain accurate, area-specific information necessary for monitoring and decision-making. Existing practices rely on manual data gathering, which is labor-intensive, time-consuming, and exposes personnel to risks during adverse weather conditions. Additionally, there is no centralized system that organizes and visualizes environmental information, limiting the ability of local offices to make timely, data-driven decisions. To address these issues, this study focuses on developing and evaluating a low-cost, calibrated Automatic Weather Station (AWS) capable of providing localized, automated, and easily accessible environmental data for Bacolor.

Based on these conditions, the study seeks to answer the following questions:

1.  How can a low-cost Automatic Weather Station (AWS) be designed and developed to provide accurate and reliable real-time meteorological data in terms of acceptable deviation, data transmission latency, and system uptime?
2.  How can the developed AWS be effectively deployed in Bacolor, Pampanga to generate site-specific meteorological datasets (temperature, humidity, and precipitation) with a temporal resolution of ≤ 15 minutes for localized environmental analysis?
3.  How can a user-friendly dashboard be developed to provide quick and clear visualization of weather information for the MDRRMO?

## Objectives and Deliverables

### General Objective
To develop and evaluate a low-cost, calibrated Automatic Weather Station (AWS) with an integrated user-friendly dashboard that provides localized, real-time environmental data to support efficient monitoring and proactive decision-making for the MDRRMO in Bacolor, Pampanga.

### Specific Objectives
*   **SO1**: To design and develop a low-cost Automatic Weather Station (AWS) that delivers real-time meteorological data with ≤ 5% deviation from reference instruments, data transmission latency of ≤ 15 minutes, and system uptime of ≥ 95%.
*   **SO2**: To deploy the developed Automatic Weather Station (AWS) in Bacolor, Pampanga, and generate site-specific meteorological datasets, including temperature, humidity, and precipitation, with a temporal resolution of ≤ 15 minutes for localized environmental analysis.
*   **SO3**: To design and implement a user-friendly dashboard that allows quick and clear visualization of weather information for the MDRRMO.

### Key Deliverables
*   A fully-autonomous calibrated, low-cost, solar-powered AWS installed in the Municipality of Bacolor, equipped with industrial-grade sensors for temperature, humidity and precipitation.
*   A secure cloud-based database and IoT gateway for storing real-time weather data with end-to-end encryption and remote access capabilities.
*   A web-based dashboard for LGU personnel, providing real-time monitoring, historical data analysis, and visualization tools.

## Significance of the Study

The results of this study are expected to benefit various sectors by providing accurate, real-time, and localized weather data, which can enhance decision-making and disaster preparedness. 

*   **Local Government Units (LGUs)**: The AWS will provide LGU personnel with continuous access to meteorological data, enabling timely and evidence-based decisions in disaster management and community safety initiatives.
*   **Community and Residents**: Residents of Bacolor can stay informed about local environmental conditions, allowing them to take proactive measures during weather disturbances, heatwaves, or other environmental hazards.
*   **Academic and Research Communities**: The AWS serves as a practical platform for studying microclimatic variations and urban heat effects, eliminating the need for complex, expensive infrastructure.

## Research Hypothesis and Assumptions

### Hypothesis
It is hypothesized that the developed low-cost Automatic Weather Station (AWS) will meet acceptable standards of accuracy, reliability, and usability for local government applications. The system will:
1.  Measure temperature, humidity, and precipitation using affordable sensors.
2.  Produce reliable baseline data through initial calibration.
3.  Improve data accuracy through signal processing and secondary calibration.
4.  Provide a user-friendly IoT-based dashboard for real-time monitoring.

### Assumptions
1.  Low-cost sensor modules will function properly and provide consistent measurements after calibration.
2.  Environmental conditions at the deployment site will remain stable enough for accurate comparisons.
3.  Signal-processing techniques will effectively reduce noise without introducing significant errors.
4.  The IoT dashboard will reliably collect and display AWS data in real time.
5.  End-users will have basic skills to operate and interpret the dashboard data.

## Scope and Delimitations

This research investigates the development of an Automatic Weather Station (AWS) deployment system for sensor effect monitoring in Bacolor, Pampanga.

**Parameters monitored:**
*   Temperature
*   Humidity
*   Precipitation

**Delimitations:**
*   Data collection is limited to a selected spot in Bacolor, Pampanga.
*   Only the three parameters listed above are measured.
*   The system utilizes a 4G LTE module for data transfer and an ESP32 microcontroller for processing.

## Definition of Terms

*   **Automatic Weather Station (AWS)**: A system composed of sensors, data acquisition modules, and communication interfaces designed to automatically measure and transmit meteorological data in real time.
*   **Internet of Things (IoT)**: A network of interconnected devices that collect and process data over the internet without direct human intervention.
*   **Meteorological Parameters**: Quantifiable variables (temperature, humidity, precipitation) describing the state of the atmosphere.
*   **Microclimate**: Localized atmospheric conditions that differ from surrounding regions due to land use, vegetation, or infrastructure.

---

# CHAPTER 2: LITERATURE REVIEW

This chapter examines the existing literature and studies pertinent to the development and implementation of Automatic Weather Station (AWS) systems, emphasizing their applications for local government in disaster preparedness, climate monitoring, and community resilience.

## Conceptual Framework

The IoT-based Automatic Weather Station (AWS) is designed to measure, record, and transmit key meteorological parameters within Bacolor, Pampanga.

### Independent Variables
*   **Meteorological Parameters**: Temperature, Humidity, Precipitation.
*   **Urban Setting Factors**: Land use, building density, vegetation.
*   **Time Factors**: Diurnal and seasonal variations.

### Intervening Variables
*   Sensor Accuracy and Calibration.
*   Environmental Interference (Extreme weather events or anomalies).
*   Data Transmission Reliability (Network availability and ESP32 performance).

### Dependent Variables
*   **Weather Data Outputs**: Real-time and historical measurements.
*   **Actionable Insights**: Data used by LGUs for disaster preparedness and environmental management.

## Existing Work

Automatic Weather Stations (AWS) are increasingly being implemented worldwide to provide localized, real-time meteorological data. These systems reduce the prohibitive costs associated with traditional stations while providing accurate measurements (Rivera et al., 2023).

### Table 1: Comparison of Methods to Assess and Model AWS in the Philippines

| Reference | Methods | Data Source | Notes |
| :--- | :--- | :--- | :--- |
| **Muñoz Jr. et al. (2018)** | Arduino-based micro-weather station with GSM alert system | Field-deployed sensors (temp, humidity, rainfall) + database logging | Achieved >95% accuracy; low-cost compared to PAGASA-grade stations. |
| **Rivera et al. (2023)** | IoT-based AWS with cloud integration | ESP32 + cloud database | Focused on accessibility, scalability, and real-time data sharing. |
| **PAGASA (2020)** | Nationwide deployment of AWS | PAGASA AWS network | Focused on national coverage; provides LGUs with access to DRR data. |
| **Ioannou (2021)** | AWS for precision agriculture | Global case studies | Highlighted AWS as decision-support tools for irrigation. |
| **PreventionWeb (2023)** | AWS for disaster resilience (GSM + sirens) | Case examples in PH | Highlighted benefits in mitigating climate risks. |
| **DILG (2014)** | National AWS program for LGU preparedness | PAGASA AWS network | Cited high costs as a barrier for rural LGUs. |

As shown in Table 1, while national programs exist, the high price of standard AWS remains a significant barrier for rural LGUs (PreventionWeb, 2023). The development of low-cost stations using platforms like Arduino or ESP32 aims to democratize access to this data (Balakit et al., 2019; Zennaro et al., 2025).

### Key Technical Challenges
*   **Standardization**: Adhering to World Meteorological Organization (WMO) guidelines for sensor exposure and shielding (Burton, 2014).
*   **Power**: Solar solutions are widely adopted but require efficient battery management (Mohapatra & Subudhi, 2022).
*   **Connectivity**: Rural areas often face weak signals, necessitating alternative protocols like LoRaWAN or cellular backup (Jabbar et al., 2022).

## Research Gaps

Despite progress, several gaps remain:
1.  **High Cost & Limited Adoption**: Rural LGUs still lack localized systems.
2.  **Accuracy & Standardization**: Low-cost prototypes often struggle with WMO compliance.
3.  **Fragmented Data**: Lack of centralized, publicly accessible databases for real-time analytics.
4.  **Narrow Use Cases**: Most projects focus solely on disaster alerts rather than urban planning or agriculture.

---

# CHAPTER 3: METHODOLOGY

## Research Design

This study employs a **quantitative, experimental, and developmental** research design.
*   **Quantitative**: Collection of numerical meteorological data to evaluate performance.
*   **Experimental**: Testing and validating sensor performance and transmission reliability.
*   **Developmental**: Design and construction of hardware, IoT integration, and dashboard development.

## Research Locale / Setting

The deployment site is located in **Bacolor, Pampanga**. Sites were selected based on WMO-No.8 (2018) criteria for high-quality measurements:
1.  Use of automatic weather stations.
2.  Use of high-quality sensors.
3.  Suitable, well-exposed sites at correct heights.
4.  Guaranteed supervision and maintenance.

> **Figure 1**: WMO Class 2 compliance requirements for temperature and humidity.
> **Figure 2**: Typical weather station layout showing sensor distances.
*(Placeholders for actual images)*

The testing period is scheduled from late January to late April 2025, covering various weather conditions to ensure system reliability.

## Research Instrument

The AWS is built using a "Light" configuration based on WMO-No.8 standards:

### Table 2: AWS Categories according to WMO-No.8
| Sensor | Light | Basic | Extended |
| :--- | :---: | :---: | :---: |
| Precipitation | ✓ | ✓ | ✓ |
| Air Temperature | ✓ | ✓ | ✓ |
| Relative Humidity | ✗ | ✓ | ✓ |
| Wind Speed | ✗ | ✓ | ✓ |
| Wind Direction | ✗ | ✓ | ✓ |
| Atmospheric Pressure | ✗ | ✓ | ✓ |

### System Components
1.  **Local AWS Unit**: ESP32 processing, industrial-grade sensors.
2.  **Power System**: LiFePo4 battery packs, Solar arrays, BMS.
3.  **Enclosure**: Stevenson Screen and sensor pole.
4.  **Connectivity**: 4G/LTE USB Modem with prepaid data.
5.  **Central System**: Google Firebase, Cloud Functions, and Hetzner VPS.

## Data Gathering Procedure

1.  **Measurement**: Data collected at 1–10 second intervals, structured in JSON.
2.  **Logging**: Local backup on SD card; transmission to cloud every 1 minute.
3.  **Operation**: Autonomous mode once deployed.
4.  **Integrity**: Automatic synchronization of unsent data after network recovery.

## Data Analysis

Sensors will be calibrated at **DOST-R3** to ensure compliance with PAGASA standards. Performance will be measured using:

### 1. Accuracy Metrics
*   **Bias**:
    $$Bias = \frac{1}{n} \sum_{i=1}^{n} (x_i - r_i)$$
*   **Mean Absolute Error (MAE)**:
    $$MAE = \frac{1}{n} \sum_{i=1}^{n} |x_i - r_i|$$
*   **Root Mean Square Error (RMSE)**:
    $$RMSE = \sqrt{\frac{1}{n} \sum_{i=1}^{n} (x_i - r_i)^2}$$

### 2. Reliability Metrics
*   **Packet Delivery Ratio (PDR)**:
    $$PDR = \left( \frac{\text{Packets Received}}{\text{Packets Sent}} \right) \times 100\%$$
*   **System Availability**:
    $$Availability = \left( \frac{\text{Uptime}}{\text{Total Time}} \right) \times 100\%$$

## Ethical Considerations

Formal permission will be sought from the Bacolor LGU and property owners. The system only collects anonymous environmental data, ensuring privacy and compliance with community welfare principles.
