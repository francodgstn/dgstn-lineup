% HMD Student App Architecture Overview

# HMD Student App - System Architecture

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    STUDENT APP (React Native)               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐         ┌──────────────┐                 │
│  │ Login Screen │         │ Profile Screen               │
│  │              │         │              │                 │
│  │ • Token Input│         │ • Personal   │                 │
│  │ • Validation │◄───────►│ • Team Info  │                 │
│  │ • Error msgs │         │ • Refresh    │                 │
│  └──────────────┘         │ • Logout     │                 │
│         ▲                  └──────────────┘                 │
│         │                                                   │
│         │ Navigation (React Navigation)                    │
│         │                                                   │
│  ┌──────▼──────────────────────────────────────────┐       │
│  │         AuthContext (State Management)          │       │
│  │                                                 │       │
│  │ • isAuthenticated                              │       │
│  │ • contact (profile data)                       │       │
│  │ • login() / logout() / refreshContact()        │       │
│  └────────────┬───────────────────────────────────┘       │
│               │                                            │
│               ▼                                            │
│  ┌─────────────────────────────────────────────┐          │
│  │  Firestore Service                          │          │
│  │                                             │          │
│  │ • validateAuthToken()                       │          │
│  │ • getContact()                              │          │
│  │ • getTeamPublicProfile()                    │          │
│  └────────────┬────────────────────────────────┘          │
│               │                                            │
│               ▼                                            │
│  ┌─────────────────────────────────────────────┐          │
│  │  Storage Service                            │          │
│  │                                             │          │
│  │ • saveAuthToken() / getAuthToken()          │          │
│  │ • saveContactId() / getContactId()          │          │
│  └────────────┬────────────────────────────────┘          │
│               │                                            │
└───────────────┼────────────────────────────────────────────┘
                │
                │ (Firebase SDK)
                │
         ┌──────▼──────────────────────────────────────────┐
         │    FIREBASE FIRESTORE (Cloud Database)          │
         ├───────────────────────────────────────────────┬─┤
         │                                               │ │
         │  ┌────────────────────────────────────────┐   │ │
         │  │ student_auth_tokens Collection         │   │ │
         │  │                                        │   │ │
         │  │ token: string                          │   │ │
         │  │ contactId: string                      │   │ │
         │  │ expiresAt: number (timestamp)          │   │ │
         │  │ createdAt: number (timestamp)          │   │ │
         │  │ used: boolean                          │   │ │
         │  └────────────────────────────────────────┘   │ │
         │                                               │ │
         │  ┌────────────────────────────────────────┐   │ │
         │  │ contacts Collection                    │   │ │
         │  │                                        │   │ │
         │  │ id: string (doc ID)                    │   │ │
         │  │ email: string                          │   │ │
         │  │ firstName: string                      │   │ │
         │  │ lastName: string                       │   │ │
         │  │ phone: string                          │   │ │
         │  │ teamId: string                         │   │ │
         │  └────────────────────────────────────────┘   │ │
         │                                               │ │
         │  ┌────────────────────────────────────────┐   │ │
         │  │ teams Collection                       │   │ │
         │  │                                        │   │ │
         │  │ id: string (doc ID)                    │   │ │
         │  │ name: string                           │   │ │
         │  │ public_profile: {                      │   │ │
         │  │   description: string                  │   │ │
         │  │   logo: string (URL)                   │   │ │
         │  │   ...                                  │   │ │
         │  │ }                                      │   │ │
         │  └────────────────────────────────────────┘   │ │
         │                                               │ │
         └───────────────────────────────────────────────┴─┘
```

## Authentication Flow

```
                         EMAIL SYSTEM
                              │
                              ▼
                    ┌──────────────────┐
                    │  sendStudentAuth │
                    │   Link Function  │
                    │  (Cloud Func)    │
                    └────────┬─────────┘
                             │
                 ┌───────────┼───────────┐
                 │           │           │
                 ▼           ▼           ▼
         ┌─────────────┐ Generate  Store in
         │ Send Email  │ Token     Firestore
         │ with token  │
         └──────┬──────┘
                │
                ▼
        ┌──────────────────┐
        │  Student opens   │
        │  email link OR   │
        │  copy/paste token│
        └────────┬─────────┘
                 │
                 ▼
        ┌──────────────────────────┐
        │  Student App             │
        │  LoginScreen             │
        │  Enters token            │
        └────────┬─────────────────┘
                 │
                 ▼
        ┌──────────────────────────┐
        │  Validate token in       │
        │  Firestore               │
        │  - Check exists          │
        │  - Check not expired     │
        │  - Get contactId         │
        └────────┬─────────────────┘
                 │
         ┌───────┴───────┐
         │               │
      Valid           Invalid
         │               │
         ▼               ▼
    Login Success    Show Error
    Store token      Ask retry
    Fetch contact    │
         │           │
         ▼           │
    ProfileScreen    │
         │           │
         └───────┬───┘
                 │
         ┌───────▼─────────┐
         │  User Logout OR │
         │  Token Expires  │
         └────────┬────────┘
                  │
                  ▼
         ┌──────────────────┐
         │ Clear token from  │
         │ - LocalStorage    │
         │ - Memory/State    │
         └────────┬─────────┘
                  │
                  ▼
           BackTo LoginScreen
```

## Data Sync Flow

```
┌────────────────────────────────────────────────────────────┐
│                   APP INITIALIZATION                       │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
         ┌───────────────┐
         │ AuthContext   │
         │ useEffect()   │
         └───────┬───────┘
                 │
                 ▼
         ┌───────────────────┐
         │ Check for saved   │
         │ token in Storage  │
         └───────┬───────────┘
                 │
         ┌───────┴──────────┐
         │                  │
    Token Found         No Token
         │                  │
         ▼                  ▼
    Validate Token    Show LoginScreen
    in Firestore           │
         │                 │
    ┌────┴────┐            │
    │          │            │
Valid     Invalid          │
    │          │            │
    ▼          ▼            │
Fetch Get            │
Contact profile      │
    │   × Remove token      │
    ▼     from storage      │
Set isAuth        │
    =true         │
    │             │
    └─────┬───────┘
          │
          ▼
    Show ProfileScreen


┌────────────────────────────────────────────────────────────┐
│                  PROFILE SCREEN LOAD                       │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
         ┌───────────────┐
         │ Contact data  │
         │ from context  │
         └────────┬──────┘
                  │
                  ▼
         ┌──────────────────────┐
         │ Does contact have    │
         │ teamId?              │
         └──────┬────────┬──────┘
                │        │
              Yes       No
                │        │
                ▼        │
    Fetch team public    │
    profile from         │
    Firestore            │
                │        │
                └────┬───┘
                     │
                     ▼
         ┌──────────────────┐
         │ Display on       │
         │ ProfileScreen    │
         └──────┬───────────┘
                │
                ▼
        Pull-to-Refresh
        available for
        re-fetch
```

## Component Hierarchy

```
┌─ App.tsx
│  │
│  ├─ AuthProvider (Context)
│  │  │
│  │  └─ AppNavigator
│  │     │
│  │     ├─ LoginScreen
│  │     │  ├─ TextInput (token)
│  │     │  ├─ TouchableOpacity (button)
│  │     │  └─ Text (help text)
│  │     │
│  │     └─ ProfileScreen
│  │        ├─ ScrollView
│  │        ├─ View (header)
│  │        │  ├─ Text (title)
│  │        │  └─ TouchableOpacity (logout)
│  │        ├─ View (section - personal)
│  │        │  └─ InfoRow × 3
│  │        │     ├─ Text (label)
│  │        │     └─ Text (value)
│  │        │
│  │        └─ View (section - team)
│  │           ├─ Text (title)
│  │           └─ InfoRow × 2
│  │              ├─ Text (label)
│  │              └─ Text (value)
│  │
│  └─ Services
│     ├─ FirestoreService
│     │  ├─ validateAuthToken()
│     │  ├─ getContact()
│     │  └─ getTeamPublicProfile()
│     │
│     └─ StorageService
│        ├─ saveAuthToken()
│        ├─ getAuthToken()
│        ├─ saveContactId()
│        └─ getContactId()
│
└─ Contexts
   └─ AuthContext
      ├─ State: contact, isLoading, isAuthenticated
      └─ Methods: login(), logout(), refreshContact()
```

## State Management

```
AuthContext State:
┌─────────────────────────────────────┐
│ contact: Contact | null             │
│ └─ id, email, firstName, lastName   │
│ └─ phone, teamId                    │
├─────────────────────────────────────┤
│ isLoading: boolean                  │
├─────────────────────────────────────┤
│ isAuthenticated: boolean            │
├─────────────────────────────────────┤
│ Methods:                            │
│ • login(token): Promise<boolean>    │
│ • logout(): Promise<void>           │
│ • refreshContact(): Promise<void>   │
└─────────────────────────────────────┘
         │
         │ Provided via
         │ useAuth() hook
         │
         ├─ LoginScreen
         │  └─ Uses: login()
         │
         └─ ProfileScreen
            └─ Uses: contact, logout(), refreshContact()
```

## Token Lifecycle

```
CREATION (sendStudentAuthLink function)
    │
    ▼
Generate random 64-char token
    │
    ▼
Store in Firestore with:
├─ token: random string
├─ contactId: student's ID
├─ expiresAt: now + 7 days
├─ createdAt: now
└─ used: false
    │
    ▼
Send via email


USAGE (Student App)
    │
    ▼
Student enters token
    │
    ▼
Query Firestore for matching token
    │
    ├─ Not found → Error
    │
    ├─ Found but expired → Error + Delete
    │
    └─ Found and valid
       │
       ▼
    Store token in AsyncStorage
       │
       ▼
    Use for re-auth on app restart
       │
       ▼
    Stay logged in until:
    ├─ User clicks logout
    ├─ Token expires (7 days)
    └─ App cache cleared
```

## Error Handling Flow

```
User Action
    │
    ▼
Try Operation
    │
    ├─ Success ──────────────────► Update UI
    │
    └─ Error
       │
       ├─ Network Error
       │  └─► Show "Check connection"
       │
       ├─ Invalid Token
       │  └─► Show "Invalid or expired"
       │
       ├─ Contact Not Found
       │  └─► Show "Account error"
       │
       └─ Firestore Error
          └─► Show "System error"
             └─► Log to console
```

---

**Architecture Version**: 1.0
**Last Updated**: January 26, 2026
