# Project Requirements Document

## 1. Variable Permission Levels Based on Threads
- Implement a thread-based permission system where different threads can have varying levels of access and control.
- Permissions should be configurable per thread, allowing granular control over what actions can be performed within each thread context.
- **Status:** done, not yet checked in the app. Top bar → Thread access (Full / Review edits first / Read-only / No project access). See PROJECT_STATUS.md.

## 2. UI Cleanup and Improvements
- Clean up and modernize the existing user interface.
- Implement additional UI improvements for better user experience.
- Ensure the interface is intuitive and visually appealing.

## 3. Built-in Skill Searcher
- Create a built-in skill searcher feature that accepts GitHub links.
- When a GitHub link is provided, the system should automatically run through 2 skill reviewers (NVIDIA SkillSpector and Cisco Skill Scanner) to validate and analyze the skill.
- Display results and recommendations from the reviewers.
- **Status:** 0.13.0 adds Settings → Add new skills (paste link, Scan, review warnings, Install / Do not install) with a built-in pattern scanner. The NVIDIA reviewers are still to do. See PROJECT_STATUS.md.

## 4. Dual Installer Versions
- Develop two separate installer versions:
  - **Server Installer**: For the main server installation
  - **Client Installer**: For client devices that connect to the server
- Both installers should be robust and handle dependencies appropriately.

## 5. iOS Mobile Application
- Develop a native iOS mobile application specifically designed for iPhone 16 Pro Max.
- The mobile app UI should be optimized for the iPhone 16 Pro Max's screen size and features.
- The mobile app should connect to and control the server installation.

## 6. Network Architecture
- Mobile and client installations will point to a device running the server installation.
- Utilize existing Tailscale installation on both server and mobile devices for secure networking.
- Ensure seamless communication between client/mobile and server over the Tailscale network.

## 7. Local LLM Integration
- Add functionality to include additional local LLMs.
- Build upon existing groundwork found in "colibri model adder".
- Allow users to add, configure, and manage local language models.

## 8. Mobile Notification System
- Implement a notification system in the mobile app for:
  - Session completion notifications
  - Requests for additional control
- Notifications should be timely and informative, keeping users updated on server activities.

## Technical Considerations
- Ensure secure communication between all components
- Maintain compatibility with existing Tailscale infrastructure
- Optimize mobile app performance for iPhone 16 Pro Max
- Implement robust error handling and logging
- Consider scalability for future feature additions